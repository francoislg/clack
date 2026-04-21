import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebClient } from "@slack/web-api";
import { createGetScheduledMessageRunsTool } from "./getScheduledMessageRuns.js";
import type { QueryToolContext } from "../types.js";
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

function stubSlackClient(): WebClient {
  const client = new WebClient();
  mock.method(client.auth, "test", async () => ({ ok: true, url: "https://t.slack.com/" }));
  mock.method(client.conversations, "info", async () => ({
    ok: true,
    channel: { id: "C456", name: "ops", is_im: false },
  }));
  return client;
}

interface ToolHandlerResult {
  content: Array<{ text: string }>;
  isError?: boolean;
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
    const result: ToolHandlerResult = await tool.handler({ id: job.id }, { sessionId: "test" });

    const parsed = JSON.parse(result.content[0].text);
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
    assert.match(result.content[0].text, /not found/i);
  });
});
