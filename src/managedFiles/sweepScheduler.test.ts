import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduler = vi.hoisted(() => ({
  start: vi.fn<DailyScheduler["start"]>(),
  stop: vi.fn<DailyScheduler["stop"]>(),
  runGuarded: vi.fn<DailyScheduler["runGuarded"]>(),
}));

vi.mock("../dailyScheduler.js", () => ({ createDailyScheduler: vi.fn(() => scheduler) }));
vi.mock("./sweep.js", () => ({ sweepManagedFiles: vi.fn(), defaultSweepDeps: vi.fn() }));
vi.mock("../config.js", () => ({ getBackupConfig: vi.fn() }));
vi.mock("../logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createDailyScheduler, type DailyJob, type DailyScheduler } from "../dailyScheduler.js";
import type { SweepResult } from "./sweep.js";
import {
  startManagedFilesSweepScheduler,
  stopManagedFilesSweepScheduler,
  type SweepSchedulerDeps,
} from "./sweepScheduler.js";

const EMPTY: SweepResult = { deleted: [], tagged: 0, dropped: 0 };

function createDeps() {
  return {
    sweep: vi.fn<SweepSchedulerDeps["sweep"]>().mockResolvedValue(EMPTY),
    now: vi.fn<SweepSchedulerDeps["now"]>(() => new Date("2026-10-05T12:00:00.000Z")),
    timezone: vi.fn<SweepSchedulerDeps["timezone"]>(() => "America/New_York"),
    logger: {
      info: vi.fn<SweepSchedulerDeps["logger"]["info"]>(),
      warn: vi.fn<SweepSchedulerDeps["logger"]["warn"]>(),
      error: vi.fn<SweepSchedulerDeps["logger"]["error"]>(),
    },
  };
}

function startedJob(): { job: DailyJob; bootTask: () => Promise<void> } {
  const call = scheduler.start.mock.calls[0];
  if (!call) throw new Error("scheduler.start was not called");
  const [job, bootTask] = call;
  if (!bootTask) throw new Error("scheduler.start got no boot task");
  return { job, bootTask };
}

describe("managed-files sweep scheduler", () => {
  beforeEach(() => {
    scheduler.start.mockReset();
    scheduler.stop.mockReset();
    scheduler.runGuarded.mockReset().mockResolvedValue(undefined);
  });

  it("uses a daily scheduler labelled for the sweep", () => {
    expect(createDailyScheduler).toHaveBeenCalledWith("Managed-files sweep");
  });

  it("starts a job that sweeps, with the deps' clock, timezone and logger", async () => {
    const deps = createDeps();
    startManagedFilesSweepScheduler(deps);

    const { job } = startedJob();
    expect(job.now).toBe(deps.now);
    expect(job.timezone).toBe(deps.timezone);
    expect(job.logger).toBe(deps.logger);
    await job.run();
    expect(deps.sweep).toHaveBeenCalledTimes(1);
  });

  it("sweeps once at start through the in-flight guard", async () => {
    startManagedFilesSweepScheduler(createDeps());

    const { job, bootTask } = startedJob();
    await bootTask();
    expect(scheduler.runGuarded).toHaveBeenCalledWith(job);
  });

  it("stops the scheduler", () => {
    stopManagedFilesSweepScheduler();
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
  });
});
