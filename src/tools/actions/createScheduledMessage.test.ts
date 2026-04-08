import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCreateScheduledMessageTool,
  type CreateScheduledMessageDeps,
} from "./createScheduledMessage.js";
import type { QueryToolContext } from "../types.js";
import { clearCronJobsCache, getJobs, createJob } from "../../cronJobs.js";

const originalCwd = process.cwd;

function makeDeps(overrides?: Partial<CreateScheduledMessageDeps>): CreateScheduledMessageDeps {
  return {
    getUserInfo: mock.fn(async () => ({ userId: "U123", tz: "America/New_York" })),
    createJob,
    ...overrides,
  };
}

function buildCtx(overrides: Partial<QueryToolContext> = {}): QueryToolContext {
  return {
    mode: "query" as const,
    userId: "U123",
    role: "dev",
    config: {
      repositories: [
        { name: "my-repo", url: "https://github.com/org/repo", description: "test repo" },
      ],
    } as QueryToolContext["config"],
    session: { sessionId: "test-session" } as QueryToolContext["session"],
    slackClient: {
      conversations: {
        list: mock.fn(async () => ({
          channels: [{ id: "C456", name: "engineering" }],
        })),
      },
    } as never as QueryToolContext["slackClient"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: true,
    ...overrides,
  } as QueryToolContext;
}

interface ToolHandlerResult {
  content: Array<{ text: string }>;
  isError?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callHandler(
  tool: any,
  args: { channel: string; cronExpression: string; prompt: string },
): Promise<ToolHandlerResult> {
  return tool.handler(args, { sessionId: "test" });
}

describe("createScheduledMessage tool", () => {
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

  it("creates a dynamic scheduled message", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "C456",
      cronExpression: "0 9 * * *",
      prompt: "Summarize PRs",
    });

    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.id);
    assert.equal(parsed.type, "dynamic");

    const jobs = await getJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].prompt, "Summarize PRs");
    assert.ok(jobs[0].timezone);
  });

  it("rejects invalid cron expression", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "C456",
      cronExpression: "not valid",
      prompt: "test",
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Invalid cron expression/);
  });

  it("resolves channel by name", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "#engineering",
      cronExpression: "0 9 * * *",
      prompt: "test",
    });

    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.channel, "C456");
  });
});
