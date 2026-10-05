import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeNextMidnight, createDailyScheduler, type DailyJob } from "./dailyScheduler.js";

const START = new Date("2026-10-05T12:00:00.000Z");
const HOUR = 3_600_000;

function createJob() {
  return {
    run: vi.fn<DailyJob["run"]>().mockResolvedValue(undefined),
    now: vi.fn<DailyJob["now"]>(() => new Date()),
    timezone: vi.fn<DailyJob["timezone"]>(() => "UTC"),
    enabled: vi.fn<NonNullable<DailyJob["enabled"]>>(() => true),
    logger: {
      info: vi.fn<DailyJob["logger"]["info"]>(),
      warn: vi.fn<DailyJob["logger"]["warn"]>(),
      error: vi.fn<DailyJob["logger"]["error"]>(),
    },
  };
}

describe("computeNextMidnight", () => {
  it("returns the next local midnight strictly after the given instant", () => {
    const next = computeNextMidnight(new Date("2026-07-10T12:00:00-04:00"), "America/New_York");
    expect(next.toISOString()).toBe(new Date("2026-07-11T00:00:00-04:00").toISOString());
  });

  it("fires once across a spring-forward DST day (no missed/duplicate midnight)", () => {
    const beforeDst = computeNextMidnight(
      new Date("2026-03-07T12:00:00-05:00"),
      "America/New_York",
    );
    expect(beforeDst.toISOString()).toBe(new Date("2026-03-08T00:00:00-05:00").toISOString());
    const afterMidnight = computeNextMidnight(beforeDst, "America/New_York");
    expect(afterMidnight.toISOString()).toBe(new Date("2026-03-09T00:00:00-04:00").toISOString());
  });

  it("fires once across a fall-back DST day (no missed/duplicate midnight)", () => {
    // New York fall-back: 2026-11-01 02:00 -> 01:00. Midnight is unaffected; the day is 25h.
    const beforeFallback = computeNextMidnight(
      new Date("2026-10-31T12:00:00-04:00"),
      "America/New_York",
    );
    expect(beforeFallback.toISOString()).toBe(new Date("2026-11-01T00:00:00-04:00").toISOString());
    const afterMidnight = computeNextMidnight(beforeFallback, "America/New_York");
    expect(afterMidnight.toISOString()).toBe(new Date("2026-11-02T00:00:00-05:00").toISOString());
  });
});

describe("createDailyScheduler", () => {
  let scheduler: ReturnType<typeof createDailyScheduler>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    scheduler = createDailyScheduler("Test job");
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it("runs the boot task on start", async () => {
    const job = createJob();
    const bootTask = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    scheduler.start(job, bootTask);
    await vi.advanceTimersByTimeAsync(0);
    expect(bootTask).toHaveBeenCalledTimes(1);
  });

  it("logs a failed boot task", async () => {
    const job = createJob();
    const error = new Error("boom");
    scheduler.start(job, () => Promise.reject(error));
    await vi.advanceTimersByTimeAsync(0);
    expect(job.logger.error).toHaveBeenCalledWith("Test job boot run error:", error);
  });

  it("fires at the next local midnight and re-arms", async () => {
    const job = createJob();
    scheduler.start(job);

    await vi.advanceTimersByTimeAsync(12 * HOUR - 1);
    expect(job.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(job.run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(job.run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps the schedule after a failed run", async () => {
    const job = createJob();
    const error = new Error("boom");
    job.run.mockRejectedValueOnce(error);
    scheduler.start(job);

    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(job.logger.error).toHaveBeenCalledWith("Test job run error:", error);
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(job.run).toHaveBeenCalledTimes(2);
  });

  it("stops firing after stop", async () => {
    const job = createJob();
    scheduler.start(job);
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(48 * HOUR);
    expect(job.run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips a run while one is still in flight", async () => {
    const job = createJob();
    let finish: () => void = () => undefined;
    job.run.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    scheduler.start(job, () => scheduler.runGuarded(job));

    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(job.run).toHaveBeenCalledTimes(1);
    expect(job.logger.warn).toHaveBeenCalledWith("Test job skipped: a run is already in flight");

    finish();
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(job.run).toHaveBeenCalledTimes(2);
  });

  it("does not leak a timer on double start", () => {
    const job = createJob();
    scheduler.start(job);
    scheduler.start(job);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not arm a timer for a disabled job", () => {
    const job = createJob();
    job.enabled.mockReturnValue(false);
    scheduler.start(job);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs and does not arm a timer when the timezone can't be read", () => {
    const job = createJob();
    const error = new Error("bad tz");
    job.timezone.mockImplementation(() => {
      throw error;
    });
    scheduler.start(job);
    expect(vi.getTimerCount()).toBe(0);
    expect(job.logger.error).toHaveBeenCalledWith(
      "Test job: cannot compute the next run — not scheduling:",
      error,
    );
  });
});
