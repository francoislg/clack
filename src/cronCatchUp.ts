import { CronExpressionParser } from "cron-parser";
import { logger } from "./logger.js";
import type { CronJob } from "./cronJobs.js";

// ============================================================================
// Missed-run computation
// ============================================================================

/** Bound on how far back {@link computeMissedRuns} scans for never-run or long-idle jobs. */
export const MISSED_RUNS_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/** Cap on entries returned by {@link computeMissedRuns} (bounded work for dense crons). */
export const MISSED_RUNS_MAX_ENTRIES = 100;

/**
 * Cron occurrences of `job` that were expected but never started: canonical slot times
 * (jitter deliberately ignored) strictly after `max(lastRunAt ?? createdAt, now − 14d)`
 * and at or before `now`, capped at {@link MISSED_RUNS_MAX_ENTRIES}. Disabled jobs have
 * no missed runs by definition. Invalid cron expressions or timezones log and return `[]`.
 */
export function computeMissedRuns(job: CronJob, now: Date = new Date()): Date[] {
  if (!job.enabled) return [];

  const lastRunMs = job.lastRunAt ? new Date(job.lastRunAt).getTime() : undefined;
  const anchorMs = lastRunMs ?? new Date(job.createdAt).getTime();
  if (!Number.isFinite(anchorMs)) {
    logger.error(`computeMissedRuns: job ${job.id} has unparseable lastRunAt/createdAt — skipping`);
    return [];
  }
  const sinceMs = Math.max(anchorMs, now.getTime() - MISSED_RUNS_LOOKBACK_MS);

  try {
    const interval = CronExpressionParser.parse(job.cronExpression, {
      currentDate: new Date(sinceMs),
      tz: job.timezone,
    });

    const missed: Date[] = [];
    while (missed.length < MISSED_RUNS_MAX_ENTRIES) {
      const occurrence = interval.next().toDate();
      if (occurrence.getTime() > now.getTime()) break;
      if (lastRunMs !== undefined && occurrence.getTime() <= lastRunMs) continue;
      missed.push(occurrence);
    }
    return missed;
  } catch (error) {
    logger.error(
      `computeMissedRuns: invalid cron expression "${job.cronExpression}" ` +
        `or timezone "${job.timezone}" for job ${job.id}:`,
      error,
    );
    return [];
  }
}

// ============================================================================
// Delayed-boot handler registry
// ============================================================================

export type DelayedBootHandler = () => void | Promise<void>;

interface RegisteredHandler {
  ownerKey: string;
  handler: DelayedBootHandler;
}

const handlers: RegisteredHandler[] = [];

/**
 * Register a handler to run once per boot, after the configured catch-up delay.
 * `ownerKey` identifies the registering plugin for log attribution only — multiple
 * registrations (same owner or not) are all invoked, in registration order.
 */
export function registerDelayedBootHandler(ownerKey: string, handler: DelayedBootHandler): void {
  handlers.push({ ownerKey, handler });
}

/**
 * Drop all registered handlers. Called from the soft-restart cache-reset path so the
 * re-initialized plugin generation registers fresh handlers instead of accumulating.
 */
export function clearDelayedBootHandlers(): void {
  handlers.length = 0;
}

/**
 * Invoke every registered handler sequentially (awaited, registration order). A handler
 * error is logged and does not prevent later handlers from running.
 */
export async function dispatchDelayedBoot(): Promise<void> {
  // Snapshot so a handler that registers or clears handlers mid-dispatch cannot
  // affect this iteration.
  const snapshot = handlers.slice();
  for (const { ownerKey, handler } of snapshot) {
    try {
      await handler();
    } catch (error) {
      logger.error(`Delayed-boot handler for "${ownerKey}" failed:`, error);
    }
  }
}

// ============================================================================
// Dispatch timer (armed by the scheduler start path, cleared by the stop path)
// ============================================================================

let dispatchTimer: ReturnType<typeof setTimeout> | null = null;

export function armDelayedBootDispatch(delayMinutes: number): void {
  cancelDelayedBootDispatch();
  dispatchTimer = setTimeout(() => {
    dispatchTimer = null;
    logger.info(`Dispatching ${handlers.length} delayed-boot handler(s)`);
    dispatchDelayedBoot().catch((error) => {
      logger.error("Delayed-boot dispatch failed:", error);
    });
  }, delayMinutes * 60_000);
  logger.info(`Delayed-boot dispatch armed (${delayMinutes} min)`);
}

export function cancelDelayedBootDispatch(): void {
  if (dispatchTimer) {
    clearTimeout(dispatchTimer);
    dispatchTimer = null;
  }
}
