import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeMissedRuns,
  registerDelayedBootHandler,
  clearDelayedBootHandlers,
  dispatchDelayedBoot,
  armDelayedBootDispatch,
  cancelDelayedBootDispatch,
  MISSED_RUNS_MAX_ENTRIES,
  MISSED_RUNS_LOOKBACK_MS,
} from "./cronCatchUp.js";
import { logger } from "./logger.js";
import type { CronJob } from "./cronJobs.js";

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-1",
    cronExpression: "0 10 * * *",
    prompt: "do the thing",
    createdBy: null,
    systemActor: "plugin:test",
    createdAt: "2026-06-01T00:00:00.000Z",
    enabled: true,
    timezone: "UTC",
    ...overrides,
  };
}

describe("computeMissedRuns", () => {
  it("returns the single missed slot after a short downtime", () => {
    const job = makeJob({ lastRunAt: "2026-06-09T10:00:05.000Z" });
    const now = new Date("2026-06-10T10:30:00.000Z");

    const missed = computeMissedRuns(job, now);

    expect(missed).toEqual([new Date("2026-06-10T10:00:00.000Z")]);
  });

  it("returns empty when the most recent slot fired", () => {
    const job = makeJob({ lastRunAt: "2026-06-10T10:00:05.000Z" });
    const now = new Date("2026-06-10T10:30:00.000Z");

    expect(computeMissedRuns(job, now)).toEqual([]);
  });

  it("returns empty for a disabled job even with missed slots", () => {
    const job = makeJob({ enabled: false, lastRunAt: "2026-06-09T10:00:05.000Z" });
    const now = new Date("2026-06-10T10:30:00.000Z");

    expect(computeMissedRuns(job, now)).toEqual([]);
  });

  it("bounds a never-run job by the 14-day lookback and the entry cap", () => {
    const job = makeJob({ cronExpression: "0 * * * *", createdAt: "2026-04-01T00:00:00.000Z" });
    const now = new Date("2026-06-10T12:00:00.000Z");

    const missed = computeMissedRuns(job, now);

    expect(missed).toHaveLength(MISSED_RUNS_MAX_ENTRIES);
    const lookbackFloor = now.getTime() - MISSED_RUNS_LOOKBACK_MS;
    expect(missed[0]!.getTime()).toBeGreaterThan(lookbackFloor);
    expect(missed.at(-1)!.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("computes slots in the job's timezone", () => {
    // 10:00 America/New_York is 14:00 UTC during EDT.
    const job = makeJob({
      timezone: "America/New_York",
      lastRunAt: "2026-06-09T14:00:05.000Z",
    });
    const now = new Date("2026-06-10T15:00:00.000Z");

    expect(computeMissedRuns(job, now)).toEqual([new Date("2026-06-10T14:00:00.000Z")]);
  });

  it("returns empty and logs for an invalid cron expression", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const job = makeJob({ cronExpression: "not a cron", lastRunAt: "2026-06-09T10:00:05.000Z" });
    const now = new Date("2026-06-10T10:30:00.000Z");

    expect(computeMissedRuns(job, now)).toEqual([]);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("returns empty and logs for an unparseable lastRunAt", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const job = makeJob({ lastRunAt: "not-a-date" });
    const now = new Date("2026-06-10T10:30:00.000Z");

    expect(computeMissedRuns(job, now)).toEqual([]);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("returns empty and logs for an invalid timezone", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const job = makeJob({ timezone: "Not/AZone", lastRunAt: "2026-06-09T10:00:05.000Z" });
    const now = new Date("2026-06-10T10:30:00.000Z");

    expect(computeMissedRuns(job, now)).toEqual([]);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});

describe("delayed-boot registry and dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearDelayedBootHandlers();
  });

  afterEach(() => {
    cancelDelayedBootDispatch();
    clearDelayedBootHandlers();
    vi.useRealTimers();
  });

  it("invokes handlers sequentially in registration order", async () => {
    const order: string[] = [];
    registerDelayedBootHandler("plugin:a", async () => {
      order.push("a");
    });
    registerDelayedBootHandler("plugin:b", async () => {
      order.push("b");
    });

    await dispatchDelayedBoot();

    expect(order).toEqual(["a", "b"]);
  });

  it("isolates a throwing handler from later handlers", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const second = vi.fn();
    registerDelayedBootHandler("plugin:a", () => {
      throw new Error("boom");
    });
    registerDelayedBootHandler("plugin:b", second);

    await dispatchDelayedBoot();

    expect(second).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("fires once after the configured delay", async () => {
    const handler = vi.fn();
    registerDelayedBootHandler("plugin:a", handler);
    armDelayedBootDispatch(3);

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(handler).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(handler).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("dispatches on the next tick when the delay is zero", async () => {
    const handler = vi.fn();
    registerDelayedBootHandler("plugin:a", handler);
    armDelayedBootDispatch(0);

    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not fire when cancelled before the delay elapses", async () => {
    const handler = vi.fn();
    registerDelayedBootHandler("plugin:a", handler);
    armDelayedBootDispatch(3);

    cancelDelayedBootDispatch();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(handler).not.toHaveBeenCalled();
  });

  it("fires again when re-armed (soft restart)", async () => {
    const handler = vi.fn();
    registerDelayedBootHandler("plugin:a", handler);

    armDelayedBootDispatch(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handler).toHaveBeenCalledOnce();

    armDelayedBootDispatch(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("invokes nothing after handlers are cleared", async () => {
    const handler = vi.fn();
    registerDelayedBootHandler("plugin:a", handler);
    clearDelayedBootHandlers();

    await dispatchDelayedBoot();

    expect(handler).not.toHaveBeenCalled();
  });
});
