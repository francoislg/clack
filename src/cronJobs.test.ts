import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJob,
  getJobs,
  getJob,
  getEnabledJobs,
  getJobsByUser,
  toggleJob,
  deleteJob,
  updateJobRunStatus,
  clearCronJobsCache,
} from "./cronJobs.js";

const originalCwd = process.cwd;

describe("cronJobs", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cron-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearCronJobsCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createJob", () => {
    it("creates a job and returns it", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "America/New_York",
      });

      assert.ok(job.id);
      assert.equal(job.cronExpression, "0 9 * * *");
      assert.equal(job.channel, "C123");
      assert.equal(job.prompt, "Summarize PRs");
      assert.equal(job.createdBy, "U456");
      assert.equal(job.timezone, "America/New_York");
      assert.equal(job.enabled, true);
      assert.ok(job.createdAt);
    });

    it("creates a one-shot job", async () => {
      const job = await createJob({
        cronExpression: "0 0 1 1 *",
        channel: "C123",
        prompt: "New year summary",
        createdBy: "U456",
        timezone: "UTC",
        oneShot: true,
      });

      assert.equal(job.oneShot, true);
    });

    it("persists requiredTools on the job", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Run trivia",
        createdBy: "U456",
        timezone: "UTC",
        requiredTools: ["mcp__trivia__submit_answers"],
      });

      assert.deepEqual(job.requiredTools, ["mcp__trivia__submit_answers"]);

      // Round-trip through disk: clear cache and re-read
      clearCronJobsCache();
      const loaded = await getJob(job.id);
      assert.ok(loaded);
      assert.deepEqual(loaded.requiredTools, ["mcp__trivia__submit_answers"]);
    });

    it("omits requiredTools field when not supplied (backwards compatible)", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
      });

      assert.equal(job.requiredTools, undefined);
    });

    it("omits requiredTools when supplied as empty array", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
        requiredTools: [],
      });

      assert.equal(job.requiredTools, undefined);
    });
  });

  describe("getJobs", () => {
    it("returns all jobs", async () => {
      await createJob({
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Job 1",
        createdBy: "U1",
        timezone: "UTC",
      });
      await createJob({
        cronExpression: "0 10 * * *",
        channel: "C2",
        prompt: "Job 2",
        createdBy: "U2",
        timezone: "UTC",
      });

      const jobs = await getJobs();
      assert.equal(jobs.length, 2);
    });
  });

  describe("getEnabledJobs", () => {
    it("returns only enabled jobs", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Job 1",
        createdBy: "U1",
        timezone: "UTC",
      });
      await createJob({
        cronExpression: "0 10 * * *",
        channel: "C2",
        prompt: "Job 2",
        createdBy: "U2",
        timezone: "UTC",
      });
      await toggleJob(job.id);

      const enabled = await getEnabledJobs();
      assert.equal(enabled.length, 1);
    });
  });

  describe("getJobsByUser", () => {
    it("filters by user", async () => {
      await createJob({
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Job 1",
        createdBy: "U1",
        timezone: "UTC",
      });
      await createJob({
        cronExpression: "0 10 * * *",
        channel: "C2",
        prompt: "Job 2",
        createdBy: "U2",
        timezone: "UTC",
      });

      const jobs = await getJobsByUser("U1");
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].createdBy, "U1");
    });
  });

  describe("toggleJob", () => {
    it("toggles enabled state", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      const toggled = await toggleJob(job.id);
      assert.equal(toggled?.enabled, false);

      const toggledBack = await toggleJob(job.id);
      assert.equal(toggledBack?.enabled, true);
    });

    it("returns null for non-existent job", async () => {
      const result = await toggleJob("nonexistent");
      assert.equal(result, null);
    });
  });

  describe("deleteJob", () => {
    it("deletes a job", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      const deleted = await deleteJob(job.id);
      assert.equal(deleted, true);

      const jobs = await getJobs();
      assert.equal(jobs.length, 0);
    });

    it("returns false for non-existent job", async () => {
      const result = await deleteJob("nonexistent");
      assert.equal(result, false);
    });
  });

  describe("updateJobRunStatus", () => {
    it("updates run status", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      await updateJobRunStatus(job.id, "success");

      const updated = await getJob(job.id);
      assert.equal(updated?.lastRunStatus, "success");
      assert.ok(updated?.lastRunAt);
    });

    it("records a run with responseTs", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      await updateJobRunStatus(job.id, "success", "1234567890.123456");

      const updated = await getJob(job.id);
      assert.equal(updated?.runs?.length, 1);
      assert.equal(updated?.runs?.[0].status, "success");
      assert.equal(updated?.runs?.[0].responseTs, "1234567890.123456");
      assert.ok(updated?.runs?.[0].executedAt);
    });

    it("records a run without responseTs on error", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      await updateJobRunStatus(job.id, "error");

      const updated = await getJob(job.id);
      assert.equal(updated?.runs?.length, 1);
      assert.equal(updated?.runs?.[0].status, "error");
      assert.equal(updated?.runs?.[0].responseTs, undefined);
    });

    it("accumulates all runs without cap", async () => {
      const job = await createJob({
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      for (let i = 0; i < 25; i++) {
        await updateJobRunStatus(job.id, "success", `ts-${i}`);
      }

      const updated = await getJob(job.id);
      assert.equal(updated?.runs?.length, 25);
      assert.equal(updated?.runs?.[0].responseTs, "ts-0");
      assert.equal(updated?.runs?.[24].responseTs, "ts-24");
    });
  });
});
