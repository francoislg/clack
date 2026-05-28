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

describe("list_scheduled_messages tool — skipConditions and skipped status", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "list-skip-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearCronJobsCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("includes skipConditions in output when set on the job", async () => {
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
      { channel: undefined, includeOtherUsers: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].skipConditions, "Skip on holidays");
  });

  it("returns skipConditions: null when not set (not omitted)", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "no conditions",
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, includeOtherUsers: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].skipConditions, null);
  });

  it("surfaces submitResponseMode when set, and null when unset", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Trivia question fire",
      createdBy: "U123",
      timezone: "UTC",
      submitResponseMode: "skipped",
    });
    await createJob({
      cronExpression: "0 10 * * *",
      channel: "C456",
      prompt: "PR summary",
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, includeOtherUsers: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    const trivia = parsed.scheduled_messages.find(
      (m: { prompt: string }) => m.prompt === "Trivia question fire",
    );
    const pr = parsed.scheduled_messages.find((m: { prompt: string }) => m.prompt === "PR summary");
    assert.equal(trivia.submitResponseMode, "skipped");
    assert.equal(pr.submitResponseMode, null);
  });

  it("returns prompts under 200 chars verbatim with promptTruncated: false", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "short prompt",
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, includeOtherUsers: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].prompt, "short prompt");
    assert.equal(parsed.scheduled_messages[0].promptTruncated, false);
  });

  it("truncates prompts longer than 200 chars and flags promptTruncated: true", async () => {
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
      { channel: undefined, includeOtherUsers: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].prompt, "x".repeat(200) + "…");
    assert.equal(parsed.scheduled_messages[0].promptTruncated, true);
  });

  it("filters by plugin owner when args.plugin is set", async () => {
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
    await createJob({
      cronExpression: "0 11 * * *",
      channel: "C456",
      prompt: "User-owned",
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ role: "admin" }));
    const result = await tool.handler(
      { channel: undefined, includeOtherUsers: true, plugin: "trivia" },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].plugin, "trivia");
    assert.equal(parsed.scheduled_messages[0].prompt, "Trivia daily");
  });

  it("plugin filter excludes user-owned jobs that have no plugin field", async () => {
    await createJob({
      cronExpression: "0 11 * * *",
      channel: "C456",
      prompt: "User-owned",
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, includeOtherUsers: undefined, plugin: "trivia" },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 0);
  });

  it("default scope returns caller's jobs and plugin-managed jobs, excludes other users'", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Caller's job",
      createdBy: "U123",
      timezone: "UTC",
    });
    await createJob({
      cronExpression: "0 10 * * *",
      channel: "C456",
      prompt: "Other user's job",
      createdBy: "U999",
      timezone: "UTC",
    });
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

    const tool = createListScheduledMessagesTool(buildCtx());
    const result = await tool.handler(
      { channel: undefined, includeOtherUsers: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    const prompts = parsed.scheduled_messages.map((m: { prompt: string }) => m.prompt).sort();
    assert.deepEqual(prompts, ["Caller's job", "Trivia plugin job"]);
  });

  it("plugin filter from a non-admin surfaces plugin-managed jobs (default scope)", async () => {
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
    await createJob({
      cronExpression: "0 12 * * *",
      channel: "C456",
      prompt: "Caller's own",
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ role: "member" }));
    const result = await tool.handler(
      { channel: undefined, includeOtherUsers: undefined, plugin: "trivia" },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].plugin, "trivia");
    assert.equal(parsed.scheduled_messages[0].prompt, "Trivia plugin job");
  });

  it("admin with includeOtherUsers: true sees other users' jobs", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Caller's job",
      createdBy: "U123",
      timezone: "UTC",
    });
    await createJob({
      cronExpression: "0 10 * * *",
      channel: "C456",
      prompt: "Other user's job",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ role: "admin" }));
    const result = await tool.handler(
      { channel: undefined, includeOtherUsers: true, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    const prompts = parsed.scheduled_messages.map((m: { prompt: string }) => m.prompt).sort();
    assert.deepEqual(prompts, ["Caller's job", "Other user's job"]);
  });

  it("non-admin passing includeOtherUsers: true falls back to default scope (silent)", async () => {
    await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Caller's job",
      createdBy: "U123",
      timezone: "UTC",
    });
    await createJob({
      cronExpression: "0 10 * * *",
      channel: "C456",
      prompt: "Other user's job",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createListScheduledMessagesTool(buildCtx({ role: "member" }));
    const result = await tool.handler(
      { channel: undefined, includeOtherUsers: true, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].prompt, "Caller's job");
  });

  it("surfaces lastRunStatus 'skipped' distinctly from 'success' and 'error'", async () => {
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
      { channel: undefined, includeOtherUsers: undefined, plugin: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].lastRunStatus, "skipped");
  });
});
