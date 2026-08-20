import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCancelScheduledMessageTool } from "./cancelScheduledMessage.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";
import { clearCronJobsCache, createJob } from "../../cronJobs.js";

const originalCwd = process.cwd;

function buildCtx(overrides: Partial<QueryToolContext> = {}): QueryToolContext {
  return {
    mode: "query" as const,
    userId: "U123",
    role: "dev",
    config: { repositories: [] } as unknown as QueryToolContext["config"],
    session: { sessionId: "test-session" } as QueryToolContext["session"],
    slackClient: null,
    changesWorkflowEnabled: false,
    cronUserSchedules: true,
    ...overrides,
  } as QueryToolContext;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callHandler(tool: any, args: Record<string, unknown>): Promise<any> {
  return tool.handler(args, { sessionId: "test" });
}

describe("cancelScheduledMessage tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tool-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearCronJobsCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("cancels own job and returns full success details", async () => {
    const job = await createJob({
      name: "Daily standup",
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "test",
      createdBy: "U123",
      timezone: "America/New_York",
    });

    const ctx = buildCtx();
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.cancelled, true);
    assert.equal(parsed.id, job.id);
    assert.equal(parsed.name, "Daily standup");
    assert.equal(parsed.channel, "C1");
    assert.equal(parsed.createdBy, "U123");
    assert.ok(parsed.schedule);
    assert.match(parsed.schedule, /Every day at 9/);
  });

  it("rejects stranger on non-shared job with ownership error", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "test",
      createdBy: "UOTHER",
      timezone: "UTC",
    });

    const ctx = buildCtx({ role: "dev", userId: "USTRANGER" });
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /only cancel your own/);
    assert.match(result.content[0].text, /<@UOTHER>/);
  });

  it("allows admin to cancel any job", async () => {
    const job = await createJob({
      name: "Weekly summary",
      cronExpression: "0 10 * * 1",
      channel: "C2",
      prompt: "test",
      createdBy: "UOTHER",
      timezone: "UTC",
    });

    const ctx = buildCtx({ role: "admin" });
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.name, "Weekly summary");
  });

  it("allows owner to cancel shared job", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "test",
      createdBy: "UOWNER",
      timezone: "UTC",
      editableByAnyone: true,
    });

    const ctx = buildCtx({ role: "dev", userId: "UOWNER" });
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
  });

  it("rejects stranger on shared job with shared-specific error", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "test",
      createdBy: "UOTHER",
      timezone: "UTC",
      editableByAnyone: true,
    });

    const ctx = buildCtx({ role: "dev", userId: "USTRANGER" });
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /shared schedule/);
    assert.match(result.content[0].text, /<@UOTHER>/);
    assert.match(result.content[0].text, /enabled: false/);
  });

  it("returns not-found for stranger accessing DM-targeted job", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "DUOTHER",
      prompt: "test",
      createdBy: "UOTHER",
      timezone: "UTC",
    });

    const ctx = buildCtx({ role: "dev", userId: "USTRANGER" });
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not found/);
  });

  it("returns error for non-existent job", async () => {
    const ctx = buildCtx();
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: "nonexistent" });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not found/);
  });

  it("rejects cancellation of plugin-managed jobs", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * 1-5",
      channel: "C123",
      prompt: "embedded trivia prompt",
      createdBy: "trivia",
      timezone: "America/New_York",
      plugin: "trivia",
      pluginManaged: true,
      specKey: "ops-daily:question",
    });

    const ctx = buildCtx({ role: "admin" });
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /managed by plugin "trivia"/);
    assert.match(parsed.error, /data\/config\.json/);
  });
});
