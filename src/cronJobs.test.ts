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
  updateJob,
  updateJobRunStatus,
  clearCronJobsCache,
  findByPluginOwner,
  getJobByIdFromCache,
} from "./cronJobs.js";
import { writeFile } from "node:fs/promises";

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
        name: "Test schedule",
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
        name: "Test schedule",
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
        name: "Test schedule",
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
        name: "Test schedule",
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
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
        requiredTools: [],
      });

      assert.equal(job.requiredTools, undefined);
    });

    it("persists skipConditions when supplied", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
        skipConditions: "Skip if no merged PRs in the last 24 hours.",
      });

      assert.equal(job.skipConditions, "Skip if no merged PRs in the last 24 hours.");

      clearCronJobsCache();
      const loaded = await getJob(job.id);
      assert.ok(loaded);
      assert.equal(loaded.skipConditions, "Skip if no merged PRs in the last 24 hours.");
    });

    it("omits skipConditions when not supplied (backwards compatible)", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
      });

      assert.equal(job.skipConditions, undefined);
    });

    it("omits skipConditions when supplied as empty string", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
        skipConditions: "",
      });

      assert.equal(job.skipConditions, undefined);
    });

    it("persists attachedTopics when supplied", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Run trivia",
        createdBy: null,
        systemActor: "plugin:trivia",
        timezone: "UTC",
        attachedTopics: ["trivia"],
      });

      assert.deepEqual(job.attachedTopics, ["trivia"]);

      clearCronJobsCache();
      const loaded = await getJob(job.id);
      assert.ok(loaded);
      assert.deepEqual(loaded.attachedTopics, ["trivia"]);
    });

    it("omits attachedTopics when not supplied", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
      });

      assert.equal(job.attachedTopics, undefined);
    });

    it("omits attachedTopics when supplied as empty array", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
        attachedTopics: [],
      });

      assert.equal(job.attachedTopics, undefined);
    });

    it("creates a system-owned job with createdBy: null + systemActor", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Run trivia",
        createdBy: null,
        systemActor: "plugin:trivia",
        timezone: "UTC",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "game-a:question",
      });

      assert.equal(job.createdBy, null);
      assert.equal(job.systemActor, "plugin:trivia");
      assert.equal(job.pluginManaged, true);

      // Round-trip
      clearCronJobsCache();
      const loaded = await getJob(job.id);
      assert.ok(loaded);
      assert.equal(loaded.createdBy, null);
      assert.equal(loaded.systemActor, "plugin:trivia");
    });

    it("omits systemActor for user-created jobs", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "ping",
        createdBy: "U456",
        timezone: "UTC",
      });
      assert.equal(job.systemActor, undefined);
    });

    it("rejects createdBy: null without systemActor", async () => {
      await assert.rejects(
        createJob({
          name: "Test schedule",
          cronExpression: "0 9 * * *",
          channel: "C123",
          prompt: "x",
          createdBy: null,
          timezone: "UTC",
        }),
        /createdBy: null requires a systemActor/,
      );
    });

    it("rejects user createdBy combined with systemActor", async () => {
      await assert.rejects(
        createJob({
          name: "Test schedule",
          cronExpression: "0 9 * * *",
          channel: "C123",
          prompt: "x",
          createdBy: "U456",
          systemActor: "plugin:trivia",
          timezone: "UTC",
        }),
        /systemActor must not be set when createdBy is a user ID/,
      );
    });
  });

  describe("updateJob (skipConditions)", () => {
    it("sets skipConditions on an existing job", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
      });

      const updated = await updateJob(job.id, { skipConditions: "Skip on weekends." });

      assert.ok(updated);
      assert.equal(updated.skipConditions, "Skip on weekends.");
    });

    it("replaces an existing skipConditions value", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
        skipConditions: "Old conditions",
      });

      const updated = await updateJob(job.id, { skipConditions: "New conditions" });

      assert.equal(updated?.skipConditions, "New conditions");
    });

    it("clears skipConditions when passed empty string", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
        skipConditions: "Skip sometimes",
      });

      const updated = await updateJob(job.id, { skipConditions: "" });

      assert.equal(updated?.skipConditions, undefined);
    });

    it("leaves skipConditions unchanged when undefined", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Summarize PRs",
        createdBy: "U456",
        timezone: "UTC",
        skipConditions: "Keep me",
      });

      const updated = await updateJob(job.id, { prompt: "New prompt" });

      assert.equal(updated?.skipConditions, "Keep me");
      assert.equal(updated?.prompt, "New prompt");
    });
  });

  describe("submitResponseMode", () => {
    it("persists submitResponseMode when supplied to createJob", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "Run trivia",
        createdBy: "U456",
        timezone: "UTC",
        submitResponseMode: "skipped",
      });

      assert.equal(job.submitResponseMode, "skipped");

      clearCronJobsCache();
      const loaded = await getJob(job.id);
      assert.equal(loaded?.submitResponseMode, "skipped");
    });

    it("omits submitResponseMode when not supplied", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "ping",
        createdBy: "U456",
        timezone: "UTC",
      });

      assert.equal(job.submitResponseMode, undefined);
    });

    it("sets submitResponseMode on an existing job via updateJob", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "ping",
        createdBy: "U456",
        timezone: "UTC",
      });

      const updated = await updateJob(job.id, { submitResponseMode: "optional" });
      assert.equal(updated?.submitResponseMode, "optional");
    });

    it("replaces an existing submitResponseMode value", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "ping",
        createdBy: "U456",
        timezone: "UTC",
        submitResponseMode: "always",
      });

      const updated = await updateJob(job.id, { submitResponseMode: "skipped" });
      assert.equal(updated?.submitResponseMode, "skipped");
    });

    it("clears submitResponseMode when passed null", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "ping",
        createdBy: "U456",
        timezone: "UTC",
        submitResponseMode: "skipped",
      });

      const updated = await updateJob(job.id, { submitResponseMode: null });
      assert.equal(updated?.submitResponseMode, undefined);
    });

    it("leaves submitResponseMode unchanged when undefined", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "ping",
        createdBy: "U456",
        timezone: "UTC",
        submitResponseMode: "skipped",
      });

      const updated = await updateJob(job.id, { prompt: "New prompt" });
      assert.equal(updated?.submitResponseMode, "skipped");
      assert.equal(updated?.prompt, "New prompt");
    });
  });

  describe("getJobs", () => {
    it("returns all jobs", async () => {
      await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Job 1",
        createdBy: "U1",
        timezone: "UTC",
      });
      await createJob({
        name: "Test schedule",
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
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Job 1",
        createdBy: "U1",
        timezone: "UTC",
      });
      await createJob({
        name: "Test schedule",
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
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Job 1",
        createdBy: "U1",
        timezone: "UTC",
      });
      await createJob({
        name: "Test schedule",
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
        name: "Test schedule",
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
        name: "Test schedule",
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
        name: "Test schedule",
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
        name: "Test schedule",
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
        name: "Test schedule",
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

    it("records a skipped run without responseTs", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      await updateJobRunStatus(job.id, "skipped");

      const updated = await getJob(job.id);
      assert.equal(updated?.lastRunStatus, "skipped");
      assert.equal(updated?.runs?.length, 1);
      assert.equal(updated?.runs?.[0].status, "skipped");
      assert.equal(updated?.runs?.[0].responseTs, undefined);
    });

    it("replaces prior error status when a skipped run occurs", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      await updateJobRunStatus(job.id, "error");
      await updateJobRunStatus(job.id, "skipped");

      const updated = await getJob(job.id);
      assert.equal(updated?.lastRunStatus, "skipped");
      assert.equal(updated?.runs?.length, 2);
    });

    it("records replayOf on a replay run", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      const asOf = "2026-05-08T09:00:00.000Z";
      await updateJobRunStatus(job.id, "success", "1234567890.111111", asOf);

      const updated = await getJob(job.id);
      assert.equal(updated?.runs?.length, 1);
      assert.equal(updated?.runs?.[0].status, "success");
      assert.equal(updated?.runs?.[0].responseTs, "1234567890.111111");
      assert.equal(updated?.runs?.[0].replayOf, asOf);
    });

    it("omits replayOf when not supplied", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      await updateJobRunStatus(job.id, "success", "1234567890.222222");

      const updated = await getJob(job.id);
      assert.equal(updated?.runs?.[0].replayOf, undefined);
    });

    it("accumulates runs below the default cap", async () => {
      const job = await createJob({
        name: "Test schedule",
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

    it("caps run history at the default of 50, dropping oldest entries", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Test",
        createdBy: "U1",
        timezone: "UTC",
      });

      for (let i = 0; i < 55; i++) {
        await updateJobRunStatus(job.id, "success", `ts-${i}`);
      }

      const updated = await getJob(job.id);
      assert.equal(updated?.runs?.length, 50);
      // Oldest 5 dropped, so ts-5 is now at index 0 and ts-54 is at the end.
      assert.equal(updated?.runs?.[0].responseTs, "ts-5");
      assert.equal(updated?.runs?.[49].responseTs, "ts-54");
    });
  });

  describe("pluginManaged + specKey persistence", () => {
    it("createJob persists pluginManaged and specKey when supplied", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * 1-5",
        channel: "C123",
        prompt: "Embedded trivia question prompt",
        createdBy: "U1",
        timezone: "America/Montreal",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "ops-daily:question",
      });

      assert.equal(job.pluginManaged, true);
      assert.equal(job.specKey, "ops-daily:question");
      assert.equal(job.plugin, "trivia");

      clearCronJobsCache();
      const reloaded = await getJob(job.id);
      assert.equal(reloaded?.pluginManaged, true);
      assert.equal(reloaded?.specKey, "ops-daily:question");
    });

    it("createJob omits pluginManaged and specKey when not supplied", async () => {
      const job = await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Plain user job",
        createdBy: "U1",
        timezone: "UTC",
      });

      assert.equal(job.pluginManaged, undefined);
      assert.equal(job.specKey, undefined);
    });

    it("createJob throws when pluginManaged is true without a specKey", async () => {
      await assert.rejects(
        () =>
          createJob({
            name: "Test schedule",
            cronExpression: "0 9 * * *",
            channel: "C1",
            prompt: "missing specKey",
            createdBy: "trivia",
            timezone: "UTC",
            plugin: "trivia",
            pluginManaged: true,
            // specKey deliberately omitted — caught by the invariant guard
          }),
        /pluginManaged jobs must carry a specKey/,
      );
    });
  });

  describe("findByPluginOwner", () => {
    it("returns only jobs matching plugin AND pluginManaged === true", async () => {
      await createJob({
        name: "Test schedule",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "trivia question",
        createdBy: "U1",
        timezone: "UTC",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "g1:question",
      });
      await createJob({
        name: "Test schedule",
        cronExpression: "0 15 * * *",
        channel: "C1",
        prompt: "trivia reveal",
        createdBy: "U1",
        timezone: "UTC",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "g1:reveal",
      });
      await createJob({
        name: "Test schedule",
        cronExpression: "0 10 * * *",
        channel: "C2",
        prompt: "weather",
        createdBy: "U1",
        timezone: "UTC",
        plugin: "weather",
        pluginManaged: true,
        specKey: "morning",
      });
      await createJob({
        name: "Test schedule",
        cronExpression: "0 11 * * *",
        channel: "C2",
        prompt: "user-created job tagged trivia",
        createdBy: "U2",
        timezone: "UTC",
        plugin: "trivia",
        // pluginManaged absent — this is a user-created job that happens to tag the plugin
      });

      const triviaOwned = await findByPluginOwner("trivia");
      assert.equal(triviaOwned.length, 2);
      assert.ok(triviaOwned.every((j) => j.plugin === "trivia" && j.pluginManaged === true));

      const weatherOwned = await findByPluginOwner("weather");
      assert.equal(weatherOwned.length, 1);
      assert.equal(weatherOwned[0].specKey, "morning");

      const unknownOwned = await findByPluginOwner("nonexistent");
      assert.equal(unknownOwned.length, 0);
    });
  });

  describe("name field", () => {
    it("persists the name on create", async () => {
      const job = await createJob({
        name: "Morning PR roundup",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "Summarize PRs",
        createdBy: "U1",
        timezone: "UTC",
      });
      assert.equal(job.name, "Morning PR roundup");
      const fetched = await getJob(job.id);
      assert.equal(fetched?.name, "Morning PR roundup");
    });

    it("loads a legacy nameless job without error", async () => {
      const legacyShape = {
        jobs: [
          {
            id: "legacy01",
            cronExpression: "0 9 * * *",
            channel: "C1",
            prompt: "legacy",
            createdBy: "U1",
            createdAt: new Date().toISOString(),
            enabled: true,
            timezone: "UTC",
          },
        ],
      };
      await writeFile(
        join(tempDir, "data", "state", "cron-jobs.json"),
        JSON.stringify(legacyShape, null, 2),
      );
      clearCronJobsCache();
      const jobs = await getJobs();
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].name, undefined);
    });

    it("overwrites name on update with a non-empty string", async () => {
      const job = await createJob({
        name: "Old label",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "x",
        createdBy: "U1",
        timezone: "UTC",
      });
      const updated = await updateJob(job.id, { name: "New label" });
      assert.equal(updated?.name, "New label");
    });

    it("clears name on update with an empty string", async () => {
      const job = await createJob({
        name: "Some label",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "x",
        createdBy: "U1",
        timezone: "UTC",
      });
      const updated = await updateJob(job.id, { name: "" });
      assert.equal(updated?.name, undefined);
    });

    it("trims whitespace-only names to clear", async () => {
      const job = await createJob({
        name: "Some label",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "x",
        createdBy: "U1",
        timezone: "UTC",
      });
      const updated = await updateJob(job.id, { name: "   " });
      assert.equal(updated?.name, undefined);
    });

    it("leaves name untouched on update without name key", async () => {
      const job = await createJob({
        name: "Stable label",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "x",
        createdBy: "U1",
        timezone: "UTC",
      });
      const updated = await updateJob(job.id, { prompt: "new prompt" });
      assert.equal(updated?.name, "Stable label");
      assert.equal(updated?.prompt, "new prompt");
    });
  });

  describe("getJobByIdFromCache", () => {
    it("returns the job synchronously when cache is warm", async () => {
      const job = await createJob({
        name: "Test",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "x",
        createdBy: "U1",
        timezone: "UTC",
      });
      const fromCache = getJobByIdFromCache(job.id);
      assert.equal(fromCache?.id, job.id);
      assert.equal(fromCache?.name, "Test");
    });

    it("returns null when cache is cold", () => {
      clearCronJobsCache();
      assert.equal(getJobByIdFromCache("anything"), null);
    });

    it("returns null when id is not in the cache", async () => {
      await createJob({
        name: "Test",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "x",
        createdBy: "U1",
        timezone: "UTC",
      });
      assert.equal(getJobByIdFromCache("does-not-exist"), null);
    });
  });
});
