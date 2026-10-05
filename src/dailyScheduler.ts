import { CronExpressionParser } from "cron-parser";

/** Next local-midnight instant in `tz` strictly after `after`, via cron-parser (DST-aware). */
export function computeNextMidnight(after: Date, tz: string): Date {
  return CronExpressionParser.parse("0 0 * * *", { currentDate: after, tz }).next().toDate();
}

export interface DailySchedulerLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface DailyJob {
  run: () => Promise<void>;
  now: () => Date;
  timezone: () => string;
  /** Checked before arming each timer; a disabled job is not rescheduled. Defaults to enabled. */
  enabled?: () => boolean;
  logger: DailySchedulerLogger;
}

export interface DailyScheduler {
  /** Arms the next-midnight timer, then runs `bootTask` (if any) independently of it. */
  start: (job: DailyJob, bootTask?: () => Promise<void>) => void;
  stop: () => void;
  /** Runs the job unless a run is already in flight. */
  runGuarded: (job: DailyJob) => Promise<void>;
}

/** A single local-midnight timer with a run-in-flight guard, labelled `label` in logs. */
export function createDailyScheduler(label: string): DailyScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let runInFlight = false;
  // True between start and stop. Guards scheduleNext so a fire's queued `.finally(scheduleNext)`
  // cannot re-arm a timer after stop has run (stop clears the timer but can't unqueue the finally).
  let active = false;

  async function runGuarded(job: DailyJob): Promise<void> {
    if (runInFlight) {
      job.logger.warn(`${label} skipped: a run is already in flight`);
      return;
    }
    runInFlight = true;
    try {
      await job.run();
    } finally {
      runInFlight = false;
    }
  }

  function scheduleNext(job: DailyJob): void {
    if (!active) return;
    let tz: string;
    let fireAt: Date;
    try {
      if (job.enabled && !job.enabled()) return;
      tz = job.timezone();
      fireAt = computeNextMidnight(job.now(), tz);
    } catch (error) {
      job.logger.error(`${label}: cannot compute the next run — not scheduling:`, error);
      return;
    }

    const delay = Math.max(0, fireAt.getTime() - job.now().getTime());
    timer = setTimeout(() => {
      timer = null;
      runGuarded(job)
        .catch((error) => job.logger.error(`${label} run error:`, error))
        .finally(() => scheduleNext(job));
    }, delay);
    job.logger.info(`${label} scheduled for ${fireAt.toISOString()} (${tz})`);
  }

  function stop(): void {
    active = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function start(job: DailyJob, bootTask?: () => Promise<void>): void {
    // Clear any prior generation's timer first, so a double-start can never leak a timer.
    stop();
    active = true;
    scheduleNext(job);
    bootTask?.().catch((error) => job.logger.error(`${label} boot run error:`, error));
  }

  return { start, stop, runGuarded };
}
