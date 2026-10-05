import { getBackupConfig } from "../config.js";
import { createDailyScheduler, type DailySchedulerLogger } from "../dailyScheduler.js";
import { logger } from "../logger.js";
import { defaultSweepDeps, sweepManagedFiles, type SweepResult } from "./sweep.js";

export interface SweepSchedulerDeps {
  sweep: () => Promise<SweepResult>;
  now: () => Date;
  timezone: () => string;
  logger: DailySchedulerLogger;
}

export function defaultSweepSchedulerDeps(): SweepSchedulerDeps {
  return {
    sweep: () => sweepManagedFiles(defaultSweepDeps()),
    now: () => new Date(),
    timezone: () => getBackupConfig().timezone,
    logger,
  };
}

const scheduler = createDailyScheduler("Managed-files sweep");

/** Sweeps once now, then daily at local midnight in the backup timezone. */
export function startManagedFilesSweepScheduler(
  deps: SweepSchedulerDeps = defaultSweepSchedulerDeps(),
): void {
  const job = {
    run: async () => {
      await deps.sweep();
    },
    now: deps.now,
    timezone: deps.timezone,
    logger: deps.logger,
  };
  scheduler.start(job, () => scheduler.runGuarded(job));
}

export function stopManagedFilesSweepScheduler(): void {
  scheduler.stop();
}
