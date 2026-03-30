import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCancelScheduledMessageTool } from "./cancelScheduledMessage.js";
import type { QueryToolContext } from "../types.js";
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
    allowScheduledMessages: true,
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

  it("cancels own job", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "test",
      createdBy: "U123",
      timezone: "UTC",
    });

    const ctx = buildCtx();
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.cancelled, true);
  });

  it("rejects non-owned job for non-admin", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "test",
      createdBy: "UOTHER",
      timezone: "UTC",
    });

    const ctx = buildCtx({ role: "dev" });
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /only cancel your own/);
  });

  it("allows admin to cancel any job", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "test",
      createdBy: "UOTHER",
      timezone: "UTC",
    });

    const ctx = buildCtx({ role: "admin" });
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: job.id });

    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
  });

  it("returns error for non-existent job", async () => {
    const ctx = buildCtx();
    const tool = createCancelScheduledMessageTool(ctx);
    const result = await callHandler(tool, { id: "nonexistent" });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not found/);
  });
});
