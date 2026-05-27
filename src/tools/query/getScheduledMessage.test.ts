import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGetScheduledMessageTool } from "./getScheduledMessage.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";
import { clearCronJobsCache, createJob } from "../../cronJobs.js";

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

describe("get_scheduled_message tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "get-scheduled-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearCronJobsCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns the full untruncated prompt for a job the caller owns", async () => {
    const longPrompt = "y".repeat(500);
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: longPrompt,
      createdBy: "U123",
      timezone: "UTC",
    });

    const tool = createGetScheduledMessageTool(buildCtx());
    const result = await tool.handler({ id: job.id }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.id, job.id);
    assert.equal(parsed.prompt, longPrompt);
    assert.equal(parsed.channel, "C456");
    assert.equal(parsed.timezone, "UTC");
  });

  it("returns an error when the job does not exist", async () => {
    const tool = createGetScheduledMessageTool(buildCtx());
    const result = await tool.handler({ id: "does-not-exist" }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.match(parsed.error, /not found/i);
  });

  it("refuses to return another user's job when caller is not admin", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "someone else's",
      createdBy: "U999",
      timezone: "UTC",
    });

    const tool = createGetScheduledMessageTool(buildCtx({ role: "dev", userId: "U123" }));
    const result = await tool.handler({ id: job.id }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.match(parsed.error, /only.*your own/i);
  });

  it("returns plugin-managed jobs to admins", async () => {
    const longPrompt = "z".repeat(800);
    const job = await createJob({
      cronExpression: "0 10 * * *",
      channel: undefined,
      prompt: longPrompt,
      createdBy: null,
      systemActor: "plugin:casual-talk",
      timezone: "UTC",
      plugin: "casual-talk",
      pluginManaged: true,
      specKey: "chatter",
      attachedTopics: ["casual-talk"],
    });

    const tool = createGetScheduledMessageTool(buildCtx({ role: "admin" }));
    const result = await tool.handler({ id: job.id }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.prompt, longPrompt);
    assert.equal(parsed.plugin, "casual-talk");
    assert.equal(parsed.pluginManaged, true);
    assert.equal(parsed.specKey, "chatter");
    assert.deepEqual(parsed.attachedTopics, ["casual-talk"]);
  });
});
