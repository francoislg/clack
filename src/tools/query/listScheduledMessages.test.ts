import { describe, it, beforeEach, afterEach } from "node:test";
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
    allowScheduledMessages: true,
    ...overrides,
  } as QueryToolContext;
}

interface ToolHandlerResult {
  content: Array<{ text: string }>;
  isError?: boolean;
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
      { channel: undefined, all: undefined },
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
      { channel: undefined, all: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].skipConditions, null);
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
      { channel: undefined, all: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.scheduled_messages[0].lastRunStatus, "skipped");
  });
});
