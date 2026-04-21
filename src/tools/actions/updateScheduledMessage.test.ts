import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpdateScheduledMessageTool } from "./updateScheduledMessage.js";
import type { QueryToolContext } from "../types.js";
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
    allowScheduledMessages: true,
    ...overrides,
  } as QueryToolContext;
}

interface ToolHandlerResult {
  content: Array<{ text: string }>;
  isError?: boolean;
}

type UpdateTool = ReturnType<typeof createUpdateScheduledMessageTool>;

function callHandler(
  tool: UpdateTool,
  args: {
    id: string;
    skipConditions?: string;
    prompt?: string;
  },
): Promise<ToolHandlerResult> {
  return tool.handler(
    {
      id: args.id,
      cronExpression: undefined,
      timezone: undefined,
      channel: undefined,
      prompt: args.prompt,
      requiredTools: undefined,
      plugin: undefined,
      skipConditions: args.skipConditions,
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

  it("returns an error when the job does not exist", async () => {
    const tool = createUpdateScheduledMessageTool(buildCtx());

    const result = await callHandler(tool, {
      id: "nonexistent-job",
      skipConditions: "whatever",
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not found/i);
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
    assert.match(result.content[0].text, /your own/i);

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
});
