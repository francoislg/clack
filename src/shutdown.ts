import type { ClaudeRunHandle } from "./claude/runHandle.js";
import { logger } from "./logger.js";

/**
 * Signal-driven graceful shutdown: on the first shutdown signal the process quiesces (the
 * three run-creation choke points refuse new runs — see `isQuiescing`), waits for in-flight
 * Claude runs to finish within a bounded grace budget, then tears down and exits. A second
 * signal forces an immediate exit.
 *
 * State is module-level and process-global by design (there is exactly one process to shut
 * down). `drainAndExit` takes its collaborators as `deps` so it carries no import of
 * `activeRuns`/`activeState`/`lifecycle` and stays unit-testable.
 */

let quiescing = false;
let draining = false;

/** True once a shutdown signal has begun quiescing. Checked at the run-creation choke points. */
export function isQuiescing(): boolean {
  return quiescing;
}

/** Enter the quiescing state so new runs are refused. Idempotent. */
export function beginQuiesce(): void {
  quiescing = true;
}

const DEFAULT_GRACE_SECONDS = 300;

/**
 * Resolve the drain grace budget in milliseconds from `SHUTDOWN_GRACE_SECONDS`. An absent,
 * invalid, or non-positive value falls back to the 300-second default. `docker stop -t` in the
 * deploy must use a timeout at least this large so Docker does not SIGKILL mid-drain.
 */
export function resolveGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SHUTDOWN_GRACE_SECONDS;
  const parsed = raw === undefined ? NaN : Number(raw);
  const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GRACE_SECONDS;
  return seconds * 1000;
}

export interface DrainDeps {
  /** Live enumeration of executing query-run handles (re-read each loop). */
  queryHandles: () => ClaudeRunHandle[];
  /** Live enumeration of executing worker/tester-run handles (re-read each loop). */
  workerHandles: () => ClaudeRunHandle[];
  /** The `busy` union used by `GET /status`: any query run or executing change in flight. */
  isBusy: () => boolean;
  /** Stop schedulers, close the status server, stop the Slack app. Must not throw. */
  teardown: () => Promise<void>;
  /** Terminate the process. Injected so tests observe the code without exiting. */
  exit: (code: number) => void;
  /** Grace budget override (ms). Defaults to `resolveGraceMs()`. */
  graceMs?: number;
  /** Clock, injected for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Cancellable-ish sleep, injected for tests. Defaults to a real `setTimeout`. */
  delay?: (ms: number) => Promise<void>;
}

const RECHECK_MS = 250;

function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Begin quiesce, drain in-flight runs up to the grace budget, then tear down and exit. On a
 * second invocation (a second signal while a drain is already running) it forces an immediate
 * `exit(1)` instead of starting a second drain.
 */
export async function drainAndExit(deps: DrainDeps): Promise<void> {
  if (draining) {
    logger.startup("Second shutdown signal received — forcing immediate exit");
    deps.exit(1);
    return;
  }
  draining = true;
  beginQuiesce();

  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? realDelay;
  const graceMs = deps.graceMs ?? resolveGraceMs();

  if (!deps.isBusy()) {
    logger.startup("Graceful shutdown: no in-flight runs — exiting immediately");
    await finish(deps);
    return;
  }

  logger.startup(`Graceful shutdown: draining in-flight runs (grace budget ${graceMs}ms)`);
  const deadline = now() + graceMs;

  // Re-derive the handle set each iteration. The quiesce gates guarantee no new run enters
  // once quiescing begins, so the set is monotonically non-increasing and the loop converges.
  while (deps.isBusy()) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const handles = [...deps.queryHandles(), ...deps.workerHandles()];
    if (handles.length === 0) break;
    await Promise.race([
      Promise.allSettled(handles.map((h) => h.futureResponse)),
      delay(Math.min(remaining, RECHECK_MS)),
    ]);
  }

  if (deps.isBusy()) {
    const stragglers = [...deps.queryHandles(), ...deps.workerHandles()];
    logger.startup(
      `Graceful shutdown: grace budget elapsed — stopping ${stragglers.length} straggler run(s)`,
    );
    const results = await Promise.allSettled(stragglers.map((h) => h.stop("shutting down")));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      logger.warn(`Graceful shutdown: ${failed} of ${stragglers.length} stragglers failed to stop`);
    }
  } else {
    logger.startup("Graceful shutdown: all in-flight runs drained");
  }

  await finish(deps);
}

async function finish(deps: DrainDeps): Promise<void> {
  let teardownFailed = false;
  try {
    await deps.teardown();
  } catch (err) {
    logger.warn(`Graceful shutdown teardown error: ${err instanceof Error ? err.message : err}`);
    teardownFailed = true;
  }
  logger.startup("Shutdown complete");
  deps.exit(teardownFailed ? 1 : 0);
}

/** Test-only: reset module state between tests. */
export function _resetForTesting(): void {
  quiescing = false;
  draining = false;
}
