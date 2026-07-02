import { DEFAULT_TESTER_MAX_CONCURRENT, getConfig } from "../config.js";

export interface ActiveTesterRun {
  sessionId: string;
  repo: string;
  branch: string;
  startedAt: Date;
}

const activeRuns = new Map<string, ActiveTesterRun>();

/**
 * Claim a tester slot. Tester runs are hard-capped (each adds a browser + the app dev
 * server on top of the worker and Claude); beyond the cap the request is rejected — the
 * worker-pool queue underneath still handles worktree contention.
 */
export function tryAcquireTesterSlot(run: Omit<ActiveTesterRun, "startedAt">): boolean {
  const cap = getConfig().tester?.maxConcurrent ?? DEFAULT_TESTER_MAX_CONCURRENT;
  if (activeRuns.size >= cap) return false;
  activeRuns.set(run.sessionId, { ...run, startedAt: new Date() });
  return true;
}

export function releaseTesterSlot(sessionId: string): void {
  activeRuns.delete(sessionId);
}

/** Active tester runs, newest last. Consumed by the Home Tab's Workers section. */
export function getActiveTesterRuns(): ActiveTesterRun[] {
  return [...activeRuns.values()];
}
