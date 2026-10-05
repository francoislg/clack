import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduler = vi.hoisted(() => ({
  start: vi.fn<DailyScheduler["start"]>(),
  stop: vi.fn<DailyScheduler["stop"]>(),
  runGuarded: vi.fn<DailyScheduler["runGuarded"]>(),
}));

vi.mock("./dailyScheduler.js", () => ({ createDailyScheduler: vi.fn(() => scheduler) }));
vi.mock("./config.js", () => ({
  getBackupConfig: vi.fn(),
  getBackupsDir: vi.fn(),
  getDataDir: vi.fn(),
}));
vi.mock("./logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { BackupConfig } from "./config.js";
import { createDailyScheduler, type DailyJob, type DailyScheduler } from "./dailyScheduler.js";
import {
  startStateBackupScheduler,
  stopStateBackupScheduler,
  type StateBackupDeps,
} from "./stateBackup.js";

function backupConfig(enabled: boolean): BackupConfig {
  return { enabled, folders: ["state"], timezone: "America/New_York" };
}

function createDeps(enabled = true) {
  return {
    getBackupConfig: vi.fn<StateBackupDeps["getBackupConfig"]>(() => backupConfig(enabled)),
    dataDir: "/data",
    backupsDir: "/data/backups",
    now: vi.fn<StateBackupDeps["now"]>(() => new Date("2026-10-05T12:00:00.000Z")),
    logger: {
      info: vi.fn<StateBackupDeps["logger"]["info"]>(),
      warn: vi.fn<StateBackupDeps["logger"]["warn"]>(),
      error: vi.fn<StateBackupDeps["logger"]["error"]>(),
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

describe("state backup scheduler", () => {
  beforeEach(() => {
    scheduler.start.mockReset();
    scheduler.stop.mockReset();
    scheduler.runGuarded.mockReset().mockResolvedValue(undefined);
  });

  it("uses a daily scheduler labelled for the state backup", () => {
    expect(createDailyScheduler).toHaveBeenCalledWith("State backup");
  });

  it("starts a job with the configured timezone and the deps' clock and logger", () => {
    const deps = createDeps();
    startStateBackupScheduler(deps);

    expect(scheduler.start).toHaveBeenCalledTimes(1);
    const { job, bootTask } = startedJob();
    expect(job.timezone()).toBe("America/New_York");
    expect(job.enabled?.()).toBe(true);
    expect(job.now).toBe(deps.now);
    expect(job.logger).toBe(deps.logger);
    expect(bootTask).toBeTypeOf("function");
  });

  it("follows the live config for enabled()", () => {
    const deps = createDeps();
    startStateBackupScheduler(deps);
    const { job } = startedJob();

    deps.getBackupConfig.mockReturnValue(backupConfig(false));
    expect(job.enabled?.()).toBe(false);
  });

  it("stops and does not start when disabled at start", () => {
    const deps = createDeps(false);
    startStateBackupScheduler(deps);

    expect(scheduler.stop).toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledWith("State backup disabled — scheduler not started");
  });

  it("stops the scheduler", () => {
    stopStateBackupScheduler();
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
  });
});
