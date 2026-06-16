import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconcileMemoryReviewCron, MEMORY_SYSTEM_ACTOR } from "./dailyReview.js";

const { getJobs, createJob, updateJob } = vi.hoisted(() => ({
  getJobs: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("../cronJobs.js", () => ({ getJobs, createJob, updateJob }));

beforeEach(() => {
  getJobs.mockReset();
  createJob.mockReset();
  updateJob.mockReset();
});

describe("reconcileMemoryReviewCron", () => {
  it("creates the review cron when none exists", async () => {
    getJobs.mockResolvedValue([]);
    await reconcileMemoryReviewCron();
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(updateJob).not.toHaveBeenCalled();
    const params = createJob.mock.calls[0][0];
    expect(params.systemActor).toBe(MEMORY_SYSTEM_ACTOR);
    expect(params.createdBy).toBeNull();
    expect(params.cronExpression).toBe("0 0 * * *");
    expect(params.submitResponseMode).toBe("skipped");
  });

  it("updates the existing review cron instead of duplicating it", async () => {
    getJobs.mockResolvedValue([
      { id: "job-1", systemActor: MEMORY_SYSTEM_ACTOR, specKey: "daily-review" },
    ]);
    await reconcileMemoryReviewCron("America/Toronto");
    expect(createJob).not.toHaveBeenCalled();
    expect(updateJob).toHaveBeenCalledTimes(1);
    expect(updateJob.mock.calls[0][0]).toBe("job-1");
  });
});
