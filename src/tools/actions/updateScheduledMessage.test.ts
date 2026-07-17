import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUpdateScheduledMessageTool,
  type UpdateScheduledMessageDeps,
} from "./updateScheduledMessage.js";
import { validateTopicNames } from "./topicValidation.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";
import { clearCronJobsCache, createJob, getJob } from "../../cronJobs.js";

const originalCwd = process.cwd;

function buildCtx(overrides: Partial<QueryToolContext> = {}): QueryToolContext {
  return {
    mode: "query" as const,
    userId: "U123",
    role: "dev",
    config: {} as QueryToolContext["config"],
    session: { sessionId: "test-session" } as QueryToolContext["session"],
    slackClient: undefined,
    changesWorkflowEnabled: false,
    cronUserSchedules: true,
    ...overrides,
  } as QueryToolContext;
}

type UpdateTool = ReturnType<typeof createUpdateScheduledMessageTool>;

function callHandler(
  tool: UpdateTool,
  args: {
    id: string;
    skipConditions?: string;
    prompt?: string;
    name?: string;
    schedule?: {
      minute: string;
      hour: string;
      dayOfMonth: string;
      month: string;
      dayOfWeek: string;
    };
    timezone?: string;
    jitterMinutes?: number;
    attached_topics?: string[];
  },
) {
  return tool.handler(
    {
      id: args.id,
      schedule: args.schedule,
      timezone: args.timezone,
      jitterMinutes: args.jitterMinutes,
      channel: undefined,
      prompt: args.prompt,
      requiredTools: undefined,
      plugin: undefined,
      skipConditions: args.skipConditions,
      name: args.name,
      attentionLevel: undefined,
      attached_topics: args.attached_topics,
    },
    { sessionId: "test" },
  );
}

describe("update_scheduled_message tool — skipConditions", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "update-skip-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearCronJobsCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  async function seedJob(skipConditions?: string) {
    return createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
      skipConditions,
    });
  }

  it("sets skipConditions when supplied as a non-empty string", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx());

    const result = await callHandler(tool, {
      id: job.id,
      skipConditions: "Skip on weekends",
    });

    assert.notEqual(result.isError, true);
    const updated = await getJob(job.id);
    assert.equal(updated?.skipConditions, "Skip on weekends");
  });

  it("clears skipConditions when supplied as empty string", async () => {
    const job = await seedJob("Old conditions");
    const tool = createUpdateScheduledMessageTool(buildCtx());

    await callHandler(tool, { id: job.id, skipConditions: "" });

    const updated = await getJob(job.id);
    assert.equal(updated?.skipConditions, undefined);
  });

  it("leaves skipConditions unchanged when the field is omitted", async () => {
    const job = await seedJob("Keep me");
    const tool = createUpdateScheduledMessageTool(buildCtx());

    await callHandler(tool, { id: job.id, prompt: "New prompt" });

    const updated = await getJob(job.id);
    assert.equal(updated?.skipConditions, "Keep me");
    assert.equal(updated?.prompt, "New prompt");
  });

  it("sets jitterMinutes when supplied", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx());

    const result = await callHandler(tool, { id: job.id, jitterMinutes: 7 });

    assert.notEqual(result.isError, true);
    const updated = await getJob(job.id);
    assert.equal(updated?.jitterMinutes, 7);
  });

  it("clears jitterMinutes when supplied as 0", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
      jitterMinutes: 10,
    });
    const tool = createUpdateScheduledMessageTool(buildCtx());

    await callHandler(tool, { id: job.id, jitterMinutes: 0 });

    const updated = await getJob(job.id);
    assert.equal(updated?.jitterMinutes, undefined);
  });

  it("leaves jitterMinutes unchanged when the field is omitted", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
      jitterMinutes: 4,
    });
    const tool = createUpdateScheduledMessageTool(buildCtx());

    await callHandler(tool, { id: job.id, prompt: "New prompt" });

    const updated = await getJob(job.id);
    assert.equal(updated?.jitterMinutes, 4);
  });

  it("returns an error when the job does not exist", async () => {
    const tool = createUpdateScheduledMessageTool(buildCtx());

    const result = await callHandler(tool, {
      id: "nonexistent-job",
      skipConditions: "whatever",
    });

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /not found/i);
  });

  it("rejects non-creator non-admin users", async () => {
    const job = await seedJob();
    const otherUserCtx = buildCtx({ userId: "U_OTHER", role: "dev" });
    const tool = createUpdateScheduledMessageTool(otherUserCtx);

    const result = await callHandler(tool, {
      id: job.id,
      skipConditions: "Try to hijack",
    });

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /your own/i);

    const unchanged = await getJob(job.id);
    assert.equal(unchanged?.skipConditions, undefined, "no change should be persisted");
  });

  it("allows admin users to update any job's skipConditions", async () => {
    const job = await seedJob();
    const adminCtx = buildCtx({ userId: "U_ADMIN", role: "admin" });
    const tool = createUpdateScheduledMessageTool(adminCtx);

    const result = await callHandler(tool, {
      id: job.id,
      skipConditions: "Admin-set condition",
    });

    assert.notEqual(result.isError, true);
    const updated = await getJob(job.id);
    assert.equal(updated?.skipConditions, "Admin-set condition");
  });

  it("rewrites cronExpression from structured schedule fields as local time", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx());

    const result = await callHandler(tool, {
      id: job.id,
      schedule: { minute: "30", hour: "11", dayOfMonth: "*", month: "*", dayOfWeek: "*" },
      timezone: "America/New_York",
    });

    assert.notEqual(result.isError, true);
    const updated = await getJob(job.id);
    assert.equal(
      updated?.cronExpression,
      "30 11 * * *",
      "hour must be stored as given (11), not UTC-converted (15)",
    );
    assert.equal(updated?.timezone, "America/New_York");
  });

  it("accepts full cron syntax in the hour field (e.g. '*' for hourly)", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx());

    const result = await callHandler(tool, {
      id: job.id,
      schedule: { minute: "0", hour: "*", dayOfMonth: "*", month: "*", dayOfWeek: "*" },
    });

    assert.notEqual(result.isError, true);
    const updated = await getJob(job.id);
    assert.equal(updated?.cronExpression, "0 * * * *");
  });

  it("rejects an invalid cron field combination in the schedule update", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx());

    const result = await callHandler(tool, {
      id: job.id,
      schedule: { minute: "0", hour: "9", dayOfMonth: "*", month: "*", dayOfWeek: "not-a-day" },
    });

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /Invalid schedule fields/);
    const unchanged = await getJob(job.id);
    assert.equal(unchanged?.cronExpression, "0 9 * * *", "no change should be persisted");
  });

  it("sets name when supplied as a non-empty string", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx());

    await callHandler(tool, { id: job.id, name: "Morning roundup" });

    const updated = await getJob(job.id);
    assert.equal(updated?.name, "Morning roundup");
  });

  it("clears name when supplied as empty string", async () => {
    const seeded = await createJob({
      name: "Old name",
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "x",
      createdBy: "U123",
      timezone: "UTC",
    });
    const tool = createUpdateScheduledMessageTool(buildCtx());

    await callHandler(tool, { id: seeded.id, name: "" });

    const updated = await getJob(seeded.id);
    assert.equal(updated?.name, undefined);
  });

  it("leaves name unchanged when the field is omitted", async () => {
    const seeded = await createJob({
      name: "Keep me",
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "x",
      createdBy: "U123",
      timezone: "UTC",
    });
    const tool = createUpdateScheduledMessageTool(buildCtx());

    await callHandler(tool, { id: seeded.id, prompt: "New prompt" });

    const updated = await getJob(seeded.id);
    assert.equal(updated?.name, "Keep me");
    assert.equal(updated?.prompt, "New prompt");
  });

  it("rejects updates to plugin-managed jobs (even for admin)", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * 1-5",
      channel: "C123",
      prompt: "embedded trivia prompt",
      createdBy: "trivia",
      timezone: "America/Montreal",
      plugin: "trivia",
      pluginManaged: true,
      specKey: "ops-daily:question",
    });

    const ctx = buildCtx({ role: "admin" });
    const tool = createUpdateScheduledMessageTool(ctx);
    const result = await callHandler(tool, {
      id: job.id,
      prompt: "trying to overwrite the embedded prompt",
    });

    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /managed by plugin "trivia"/);
    assert.match(parsed.error, /data\/config\.json/);

    // Verify the persisted job was NOT modified.
    const unchanged = await getJob(job.id);
    assert.equal(unchanged?.prompt, "embedded trivia prompt");
  });

  function topicDeps(): UpdateScheduledMessageDeps {
    return {
      collectKnownTopics: vi.fn(() => ["response-rendering", "trivia"]),
      validateTopicNames,
    };
  }

  it("replaces attachedTopics when attached_topics is supplied", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx(), topicDeps());

    const result = await callHandler(tool, { id: job.id, attached_topics: ["trivia"] });

    assert.notEqual(result.isError, true);
    const updated = await getJob(job.id);
    assert.deepEqual(updated?.attachedTopics, ["trivia"]);
  });

  it("clears attachedTopics with an empty array", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx(), topicDeps());
    await callHandler(tool, { id: job.id, attached_topics: ["response-rendering"] });

    await callHandler(tool, { id: job.id, attached_topics: [] });

    const updated = await getJob(job.id);
    assert.equal(updated?.attachedTopics, undefined);
  });

  it("leaves attachedTopics unchanged when the field is omitted", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx(), topicDeps());
    await callHandler(tool, { id: job.id, attached_topics: ["response-rendering"] });

    await callHandler(tool, { id: job.id, prompt: "New prompt" });

    const updated = await getJob(job.id);
    assert.deepEqual(updated?.attachedTopics, ["response-rendering"]);
  });

  it("rejects unknown topic names and leaves the job untouched", async () => {
    const job = await seedJob();
    const tool = createUpdateScheduledMessageTool(buildCtx(), topicDeps());

    const result = await callHandler(tool, { id: job.id, attached_topics: ["nope"] });

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /Unknown topic name\(s\): nope/);
    assert.match(toolResultText(result), /Known topics: response-rendering, trivia/);
    const unchanged = await getJob(job.id);
    assert.equal(unchanged?.attachedTopics, undefined);
  });
});
