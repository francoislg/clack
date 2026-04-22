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
  kill(signal?: NodeJS.Signals): boolean;
}

const MAX_OUTPUT_BYTES = 64 * 1024;

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

export type SpawnFn = (command: string, options: { cwd: string; shell: boolean }) => SpawnedChild;

export interface RunVerificationChecksDeps {
  spawn: SpawnFn;
  appendExecutionLog: typeof appendExecutionLog;
  now: () => number;
}

export const defaultRunVerificationChecksDeps: RunVerificationChecksDeps = {
  spawn: (command: string, options: { cwd: string; shell: boolean }) =>
    spawn(command, { cwd: options.cwd, shell: options.shell }),
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
      child = deps.spawn(check.command, { cwd: worktreePath, shell: true });
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

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, check.timeoutSeconds * 1000);

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({
        result: "fail",
        checkName: check.name,
        exitCode: -1,
        output: `process error: ${err.message}`,
        durationMs: deps.now() - started,
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      const durationMs = deps.now() - started;
      const output = truncateBytesTail(chunks.join(""), MAX_OUTPUT_BYTES);
      const exitCode = code ?? -1;
      if (!timedOut && exitCode === 0) {
        resolve({ result: "pass", checkName: check.name, durationMs });
      } else {
        resolve({
          result: "fail",
          checkName: check.name,
          exitCode,
          output,
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
