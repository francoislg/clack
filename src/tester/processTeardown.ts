import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { APP_PROCESS_INFO_FILENAME } from "./prompt.js";

const execFileAsync = promisify(execFile);

// Graceful reader: the file is written by the tester prompt's Claude run, so a malformed
// or missing file must degrade to "nothing tracked", never throw.
const appProcessInfoZod = z.object({
  pid: z.number().int().positive().optional(),
  port: z.number().int().positive().optional(),
});

export type AppProcessInfo = z.infer<typeof appProcessInfoZod>;

export function readAppProcessInfo(worktreePath: string): AppProcessInfo | null {
  const infoPath = join(worktreePath, APP_PROCESS_INFO_FILENAME);
  if (!existsSync(infoPath)) return null;
  try {
    const parsed = appProcessInfoZod.safeParse(JSON.parse(readFileSync(infoPath, "utf-8")));
    if (!parsed.success) {
      logger.warn(`Malformed ${APP_PROCESS_INFO_FILENAME} in ${worktreePath}; ignoring`);
      return null;
    }
    return parsed.data;
  } catch (err) {
    logger.warn(`Could not read ${APP_PROCESS_INFO_FILENAME}: ${errorMessage(err)}`);
    return null;
  }
}

export interface TeardownDeps {
  kill: (pid: number, signal: NodeJS.Signals | 0) => void;
  listPidsOnPort: (port: number) => Promise<number[]>;
  listPidsByCmdline: (needle: string) => Promise<number[]>;
  delay: (ms: number) => Promise<void>;
}

function parsePidList(stdout: string): number[] {
  return stdout
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function defaultListPidsOnPort(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`]);
    return parsePidList(stdout);
  } catch {
    // lsof exits non-zero when nothing listens on the port
    return [];
  }
}

async function defaultListPidsByCmdline(needle: string): Promise<number[]> {
  try {
    // pgrep -f takes an ERE; escape metacharacters so the path matches literally.
    const pattern = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const { stdout } = await execFileAsync("pgrep", ["-f", pattern]);
    return parsePidList(stdout).filter((pid) => pid !== process.pid);
  } catch {
    // pgrep exits non-zero when nothing matches
    return [];
  }
}

export const defaultTeardownDeps: TeardownDeps = {
  kill: (pid, signal) => process.kill(pid, signal),
  listPidsOnPort: defaultListPidsOnPort,
  listPidsByCmdline: defaultListPidsByCmdline,
  delay: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
};

function isAlive(pid: number, deps: TeardownDeps): boolean {
  try {
    deps.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killPid(pid: number, deps: TeardownDeps): Promise<void> {
  // The tracked pid is often a wrapper (npx/pnpm) whose real server runs as a child
  // that keeps the wrapper's process group even after being orphaned — so signal the
  // whole group (negative pid) as well as the pid itself. A dead/non-leader target is
  // filtered out by the liveness probe.
  const targets = [-pid, pid].filter((target) => isAlive(target, deps));
  if (targets.length === 0) return;
  for (const target of targets) {
    try {
      deps.kill(target, "SIGTERM");
    } catch (err) {
      logger.warn(`SIGTERM of tester app process ${target} failed: ${errorMessage(err)}`);
    }
  }
  await deps.delay(3000);
  for (const target of targets) {
    if (!isAlive(target, deps)) continue;
    try {
      deps.kill(target, "SIGKILL");
    } catch (err) {
      logger.warn(`SIGKILL of tester app process ${target} failed: ${errorMessage(err)}`);
    }
  }
}

/**
 * Kill the app process a tester run started, by tracked PID (and its process group),
 * a port-lookup fallback, and a worktree-cmdline sweep for stray supervisors.
 * Runs on EVERY tester exit path (success, error, cancel, timeout) and never throws —
 * a failed kill (process already gone) is logged and cleanup continues. Independent of
 * worktree removal: `rm -rf` deletes files, not processes.
 */
export async function teardownAppProcess(
  worktreePath: string,
  deps: TeardownDeps = defaultTeardownDeps,
): Promise<void> {
  const info = readAppProcessInfo(worktreePath);

  if (info?.pid) {
    await killPid(info.pid, deps);
  }

  if (info?.port) {
    const pids = await deps.listPidsOnPort(info.port);
    for (const pid of pids) {
      await killPid(pid, deps);
    }
  }

  // Supervisor wrappers (pnpm/nodemon/…) survive the pid and port kills: they aren't
  // in the tracked pid's group and don't listen on the port. Their command lines
  // reference the worktree, so sweep by that — and do it even with no info file,
  // which is exactly the state a crashed run leaves behind.
  const strays = await deps.listPidsByCmdline(worktreePath);
  for (const pid of strays) {
    await killPid(pid, deps);
  }

  try {
    rmSync(join(worktreePath, APP_PROCESS_INFO_FILENAME), { force: true });
  } catch (err) {
    logger.warn(`Could not remove ${APP_PROCESS_INFO_FILENAME}: ${errorMessage(err)}`);
  }
}
