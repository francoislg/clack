import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebClient } from "@slack/web-api";
import { createGetScheduledMessageRunsTool } from "./getScheduledMessageRuns.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";
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

function stubSlackClient(): WebClient {
  const client = new WebClient();
  vi.spyOn(client.auth, "test").mockImplementation(async () => ({
    ok: true,
    url: "https://t.slack.com/",
  }));
  vi.spyOn(client.conversations, "info").mockImplementation(async () => ({
    ok: true,
    channel: { id: "C456", name: "ops", is_im: false },
  }));
  return client;
}

describe("get_scheduled_message_runs tool — skipped outcome", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "runs-skip-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearCronJobsCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns runs where status is 'skipped' distinctly from success and error", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "PRs",
      createdBy: "U123",
      timezone: "UTC",
    });

    await updateJobRunStatus(job.id, "success", "111.111");
    await updateJobRunStatus(job.id, "skipped");
    await updateJobRunStatus(job.id, "error");

    const tool = createGetScheduledMessageRunsTool(buildCtx({ slackClient: stubSlackClient() }));
    const result = await tool.handler({ id: job.id }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 3);
    const statuses = parsed.runs.map((r: { status: string }) => r.status);
    assert.deepEqual(statuses, ["success", "skipped", "error"]);

    const skippedRun = parsed.runs.find((r: { status: string }) => r.status === "skipped");
    assert.ok(skippedRun);
    assert.equal(skippedRun.link, undefined, "skipped runs have no responseTs → no link");
  });

  it("returns error for non-existent job", async () => {
    const tool = createGetScheduledMessageRunsTool(buildCtx());
    const result = await tool.handler({ id: "nope" }, { sessionId: "test" });

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /not found/i);
  });

  it("surfaces submitResponseMode and an explanatory note when job is in skipped mode", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Post trivia questions",
      createdBy: "U123",
      timezone: "UTC",
      submitResponseMode: "skipped",
    });

    await updateJobRunStatus(job.id, "skipped");
    await updateJobRunStatus(job.id, "skipped");

    const tool = createGetScheduledMessageRunsTool(buildCtx({ slackClient: stubSlackClient() }));
    const result = await tool.handler({ id: job.id }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.submitResponseMode, "skipped");
    assert.match(parsed.note, /terminator behavior/);
    assert.equal(parsed.count, 2);
  });

  it("does not include the note when submitResponseMode is unset", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
    });

    await updateJobRunStatus(job.id, "success", "111.222");

    const tool = createGetScheduledMessageRunsTool(buildCtx({ slackClient: stubSlackClient() }));
    const result = await tool.handler({ id: job.id }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.submitResponseMode, undefined);
    assert.equal(parsed.note, undefined);
  });
});
