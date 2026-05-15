import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { appendExecutionLog } from "../persistence.js";
import { truncateBytesTail } from "../../text.js";
import type { VerificationCheck } from "./config.js";

/**
 * Minimal subset of `ChildProcess` the runner needs. A real `ChildProcess` from
 * `node:child_process` satisfies this shape, and tests can provide a stub
 * without double-casting.
 */
export interface SpawnedChild extends EventEmitter {
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
}

const MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Grace window between SIGTERM to the process group and SIGKILL. Long enough for
 * pnpm/tsc to flush, short enough that a wedged process can't keep the worker
 * blocked. Picked empirically; tests inject a smaller value via `deps`.
 */
const KILL_GRACE_MS = 5_000;

export type CheckPassResult = {
  result: "pass";
  checkName: string;
  durationMs: number;
};

export type CheckFailResult = {
  result: "fail";
  checkName: string;
  exitCode: number;
  output: string;
  durationMs: number;
  timedOut: boolean;
};

export type CheckRunResult = CheckPassResult | CheckFailResult;

export type GateRunResult =
  | { result: "pass"; checks: CheckPassResult[] }
  | { result: "fail"; checks: CheckPassResult[]; failure: CheckFailResult };

export interface SpawnOptions {
  cwd: string;
  shell: boolean;
  detached: boolean;
  stdio: ["ignore", "pipe", "pipe"];
}

export type SpawnFn = (command: string, options: SpawnOptions) => SpawnedChild;

/**
 * Send `signal` to the entire process group of `pid` (negative-pid trick).
 * Returns false when there's no pid or the group is already gone.
 */
export type KillGroupFn = (pid: number, signal: NodeJS.Signals) => boolean;

export interface RunVerificationChecksDeps {
  spawn: SpawnFn;
  killGroup: KillGroupFn;
  appendExecutionLog: typeof appendExecutionLog;
  now: () => number;
  /** Override for `KILL_GRACE_MS` in tests so they don't sit on real timers. */
  killGraceMs?: number;
}

const defaultKillGroup: KillGroupFn = (pid, signal) => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
};

export const defaultRunVerificationChecksDeps: RunVerificationChecksDeps = {
  spawn: (command, options) =>
    spawn(command, {
      cwd: options.cwd,
      shell: options.shell,
      detached: options.detached,
      stdio: options.stdio,
    }),
  killGroup: defaultKillGroup,
  appendExecutionLog,
  now: () => Date.now(),
};

export interface RunVerificationChecksOptions {
  worktreePath: string;
  checks: VerificationCheck[];
  branchName: string;
}

function runSingleCheck(
  check: VerificationCheck,
  worktreePath: string,
  deps: RunVerificationChecksDeps,
): Promise<CheckRunResult> {
  return new Promise<CheckRunResult>((resolve) => {
    const started = deps.now();
    let child: SpawnedChild;
    try {
      // detached + stdio[0]='ignore': child runs in its own process group with
      // /dev/null on stdin so descendants can't block reading from an inherited
      // pipe (the bug that wedged a typecheck for 2h on 2026-05-14). Pair with
      // killGroup(-pid) on timeout so SIGTERM reaches grandchildren under
      // `shell: true`, where plain `child.kill` would only signal the sh wrapper.
      child = deps.spawn(check.command, {
        cwd: worktreePath,
        shell: true,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        result: "fail",
        checkName: check.name,
        exitCode: -1,
        output: `spawn failed: ${String(err)}`,
        durationMs: deps.now() - started,
        timedOut: false,
      });
      return;
    }

    const chunks: string[] = [];
    let bytes = 0;
    const append = (chunk: Buffer): void => {
      const s = chunk.toString("utf-8");
      chunks.push(s);
      bytes += Buffer.byteLength(s, "utf-8");
      // Keep memory bounded — prune from the front when we exceed twice the cap
      if (bytes > MAX_OUTPUT_BYTES * 2) {
        while (chunks.length > 1 && bytes > MAX_OUTPUT_BYTES) {
          const removed = chunks.shift();
          if (removed !== undefined) {
            bytes -= Buffer.byteLength(removed, "utf-8");
          }
        }
      }
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    let settled = false;
    let timedOut = false;
    let killEscalationId: NodeJS.Timeout | undefined;
    let hardResolveId: NodeJS.Timeout | undefined;
    const graceMs = deps.killGraceMs ?? KILL_GRACE_MS;

    const settle = (result: CheckRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (killEscalationId) clearTimeout(killEscalationId);
      if (hardResolveId) clearTimeout(hardResolveId);
      resolve(result);
    };

    const buildOutput = (): string => truncateBytesTail(chunks.join(""), MAX_OUTPUT_BYTES);

    const timeoutId = setTimeout(() => {
      timedOut = true;
      const pid = child.pid;
      if (pid !== undefined) {
        deps.killGroup(pid, "SIGTERM");
        killEscalationId = setTimeout(() => {
          deps.killGroup(pid, "SIGKILL");
        }, graceMs);
      } else {
        // No pid — best-effort kill on the handle. May only signal sh, but
        // there's nothing else we can do without a pid for the group.
        child.kill("SIGTERM");
      }
      // Hard fallback: resolve a moment after SIGKILL so a wedged descendant
      // holding the stdout/stderr pipe open can't keep `close` from firing and
      // block git_push indefinitely. The leaked process will exit on its own;
      // we just stop waiting for it.
      hardResolveId = setTimeout(() => {
        settle({
          result: "fail",
          checkName: check.name,
          exitCode: -1,
          output: buildOutput(),
          durationMs: deps.now() - started,
          timedOut: true,
        });
      }, graceMs * 2);
    }, check.timeoutSeconds * 1000);

    child.on("error", (err) => {
      settle({
        result: "fail",
        checkName: check.name,
        exitCode: -1,
        output: `process error: ${err.message}`,
        durationMs: deps.now() - started,
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      const durationMs = deps.now() - started;
      const exitCode = code ?? -1;
      if (!timedOut && exitCode === 0) {
        settle({ result: "pass", checkName: check.name, durationMs });
      } else {
        settle({
          result: "fail",
          checkName: check.name,
          exitCode,
          output: buildOutput(),
          durationMs,
          timedOut,
        });
      }
    });
  });
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

export async function runVerificationChecks(
  opts: RunVerificationChecksOptions,
  deps: RunVerificationChecksDeps = defaultRunVerificationChecksDeps,
): Promise<GateRunResult> {
  const passed: CheckPassResult[] = [];
  for (const check of opts.checks) {
    deps.appendExecutionLog(opts.branchName, `Verification: ${check.name} — running`);
    const result = await runSingleCheck(check, opts.worktreePath, deps);
    if (result.result === "pass") {
      deps.appendExecutionLog(
        opts.branchName,
        `Verification: ${check.name} — passed (${formatSeconds(result.durationMs)}s)`,
      );
      passed.push(result);
    } else {
      const reason = result.timedOut ? "TIMEOUT" : `exit ${result.exitCode}`;
      deps.appendExecutionLog(
        opts.branchName,
        `Verification: ${check.name} — FAILED (${reason}, ${formatSeconds(result.durationMs)}s)`,
      );
      return { result: "fail", checks: passed, failure: result };
    }
  }
  return { result: "pass", checks: passed };
}
