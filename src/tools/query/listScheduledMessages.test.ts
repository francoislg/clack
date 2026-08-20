import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createListScheduledMessagesTool } from "./listScheduledMessages.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";
import { clearCronJobsCache, createJob, updateJobRunStatus } from "../../cronJobs.js";

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

describe("list_scheduled_messages tool — universal redacted visibility", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "list-redact-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearCronJobsCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("non-admin sees another user's channel job as redacted row", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Secret admin job",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123", role: "member" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].redacted, true);
    assert.equal(parsed.scheduled_messages[0].id, parsed.scheduled_messages[0].id);
    assert.equal(parsed.scheduled_messages[0].createdBy, "U999");
    assert.equal(parsed.scheduled_messages[0].schedule, parsed.scheduled_messages[0].schedule);
    assert(!("prompt" in parsed.scheduled_messages[0]), "Redacted row should not have prompt");
    assert(
      !("promptTruncated" in parsed.scheduled_messages[0]),
      "Redacted row should not have promptTruncated",
    );
    assert(
      !("requiredTools" in parsed.scheduled_messages[0]),
      "Redacted row should not have requiredTools",
    );
    assert(
      !("skipConditions" in parsed.scheduled_messages[0]),
      "Redacted row should not have skipConditions",
    );
  });

  it("owner sees their own job in full", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "My secret prompt content",
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].redacted, undefined);
    assert.equal(parsed.scheduled_messages[0].prompt, "My secret prompt content");
    assert.equal(parsed.scheduled_messages[0].promptTruncated, false);
  });

  it("admin sees another user's channel job in full", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "User's job full details",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123", role: "admin" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].redacted, undefined);
    assert.equal(parsed.scheduled_messages[0].prompt, "User's job full details");
    assert.equal(parsed.scheduled_messages[0].createdBy, "U999");
  });

  it("non-admin sees editableByAnyone job in full even when created by another user", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Shared job prompt",
      createdBy: "U999",
      timezone: "UTC",
      editableByAnyone: true,
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123", role: "member" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].redacted, undefined);
    assert.equal(parsed.scheduled_messages[0].prompt, "Shared job prompt");
    assert.equal(parsed.scheduled_messages[0].editableByAnyone, true);
  });

  it("non-admin does not see another user's DM-targeted job", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "D456",
      prompt: "Private DM",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123", role: "member" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 0);
  });

  it("non-admin does not see another user's channelless non-plugin job", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      prompt: "Personal channelless",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123", role: "member" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 0);
  });

  it("admin sees another user's DM-targeted job", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "D456",
      prompt: "Private DM",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123", role: "admin" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].channel, "D456");
    assert.equal(parsed.scheduled_messages[0].redacted, undefined);
  });

  it("admin sees another user's channelless non-plugin job", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      prompt: "Personal channelless",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123", role: "admin" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].redacted, undefined);
  });

  it("channel filter narrows results", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Channel C456 job",
      createdBy: "U999",
      timezone: "UTC",
    });
    await createJob({
      cronExpression: "0 10 * * *",
      channel: "C789",
      prompt: "Channel C789 job",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123", role: "member" }));
    const result = await tool.handler(
      { channel: "C456", plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].channel, "C456");
  });

  it("plugin filter works with plugin-managed jobs", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Trivia daily",
      createdBy: null,
      systemActor: "plugin:trivia",
      timezone: "UTC",
      plugin: "trivia",
      pluginManaged: true,
      specKey: "daily",
    });
    await createJob({
      cronExpression: "0 10 * * *",
      channel: "C456",
      prompt: "Casual-talk daily",
      createdBy: null,
      systemActor: "plugin:casual-talk",
      timezone: "UTC",
      plugin: "casual-talk",
      pluginManaged: true,
      specKey: "daily",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ role: "admin" }));
    const result = await tool.handler(
      { channel: undefined, plugin: "trivia" },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].plugin, "trivia");
  });

  it("includes skipConditions in full rows when set", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
      skipConditions: "Skip on holidays",
    });

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].skipConditions, "Skip on holidays");
  });

  it("returns skipConditions: null in full rows when not set", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "no conditions",
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].skipConditions, null);
  });

  it("surfaces submitResponseMode when set in full rows", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Trivia question fire",
      createdBy: "U123",
      timezone: "UTC",
      submitResponseMode: "skipped",
    });

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].submitResponseMode, "skipped");
  });

  it("truncates long prompts in full rows and flags promptTruncated", async () => {
    const longPrompt = "x".repeat(500);
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: longPrompt,
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].prompt, "x".repeat(200) + "…");
    assert.equal(parsed.scheduled_messages[0].promptTruncated, true);
  });

  it("includes editableByAnyone in both full and redacted rows", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Editable by all",
      createdBy: "U999",
      timezone: "UTC",
      editableByAnyone: true,
    });

    const tool = createListScheduledMessagesTool(buildCtx({ userId: "U123", role: "member" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].editableByAnyone, true);
  });

  it("surfaces lastRunStatus distinctly from success and error", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "PRs",
      createdBy: "U123",
      timezone: "UTC",
    });
    await updateJobRunStatus(job.id, "skipped");

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].lastRunStatus, "skipped");
  });

  it("plugin-managed jobs are visible to non-admins as full rows", async () => {
    await createJob({
      cronExpression: "0 11 * * *",
      channel: "C456",
      prompt: "Trivia plugin job",
      createdBy: null,
      systemActor: "plugin:trivia",
      timezone: "UTC",
      plugin: "trivia",
      pluginManaged: true,
      specKey: "daily:question",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ role: "member" }));
    const result = await tool.handler(
      { channel: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].redacted, undefined);
    assert.equal(parsed.scheduled_messages[0].prompt, "Trivia plugin job");
  });
});
