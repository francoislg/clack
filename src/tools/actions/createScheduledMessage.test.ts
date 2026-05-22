import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebClient } from "@slack/web-api";
import {
  createCreateScheduledMessageTool,
  type CreateScheduledMessageDeps,
} from "./createScheduledMessage.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";
import { clearCronJobsCache, getJobs, createJob } from "../../cronJobs.js";

const originalCwd = process.cwd;

function makeDeps(overrides?: Partial<CreateScheduledMessageDeps>): CreateScheduledMessageDeps {
  return {
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
  content: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  [key: string]: unknown;
}

interface CallArgs {
  channel: string;
  prompt: string;
  name?: string;
  minute?: string;
  hour?: string;
  dayOfMonth?: string;
  month?: string;
  dayOfWeek?: string;
  timezone?: string;
  skipConditions?: string;
  submitResponseMode?: "always" | "optional" | "skipped";
}

type CreateTool = ReturnType<typeof createCreateScheduledMessageTool>;

function callHandler(tool: CreateTool, args: CallArgs) {
  return tool.handler(
    {
      name: "Test schedule",
      minute: "0",
      hour: "9",
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
      timezone: "America/New_York",
      oneShot: undefined,
      requiredTools: undefined,
      plugin: undefined,
      skipConditions: undefined,
      submitResponseMode: undefined,
      ...args,
    },
    { sessionId: "test" },
  );
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
      prompt: "Summarize PRs",
    });

    const parsed = parseToolResult(result as any);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.id);
    assert.equal(parsed.type, "dynamic");

    const jobs = await getJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].prompt, "Summarize PRs");
    assert.ok(jobs[0].timezone);
  });

  it("stores the local hour/minute unchanged — no UTC conversion", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    await callHandler(tool, {
      channel: "C456",
      minute: "30",
      hour: "11",
      timezone: "America/New_York",
      prompt: "Morning standup",
    });

    const jobs = await getJobs();
    assert.equal(jobs.length, 1);
    assert.equal(
      jobs[0].cronExpression,
      "30 11 * * *",
      "hour must be stored as given (11), not UTC-converted (15)",
    );
    assert.equal(jobs[0].timezone, "America/New_York");
  });

  it("returns a human-readable schedule the caller can quote verbatim", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "C456",
      minute: "30",
      hour: "11",
      timezone: "America/New_York",
      prompt: "Morning standup",
    });

    const parsed = parseToolResult(result as any);
    assert.match(parsed.schedule, /11:30 AM (EDT|EST)/);
  });

  it("accepts '*' in the hour field for hourly schedules", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "C456",
      minute: "0",
      hour: "*",
      timezone: "America/New_York",
      prompt: "Hourly digest",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);

    const jobs = await getJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].cronExpression, "0 * * * *");
  });

  it("accepts step syntax in the minute field for every-N-minutes schedules", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "C456",
      minute: "*/15",
      hour: "*",
      timezone: "UTC",
      prompt: "Poll",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);

    const jobs = await getJobs();
    assert.equal(jobs[0].cronExpression, "*/15 * * * *");
  });

  it("rejects invalid cron field combinations", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "C456",
      dayOfWeek: "not-a-day",
      prompt: "test",
    });

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /Invalid schedule fields/);
  });

  it("resolves channel by name", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "#engineering",
      prompt: "test",
    });

    const parsed = parseToolResult(result as any);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.channel, "C456");
  });

  it("normalizes the requester's own user ID to a DM channel", async () => {
    const client = new WebClient();
    mock.method(client.conversations, "open", async () => ({
      ok: true,
      channel: { id: "D_SELF" },
    }));

    const ctx = buildCtx({ slackClient: client });
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);

    const result = await callHandler(tool, {
      channel: "U123",
      prompt: "daily self-DM",
    });

    const parsed = parseToolResult(result as any);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.channel, "D_SELF");

    const jobs = await getJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].channel, "D_SELF", "stored channel should be the D-id, not the U-id");
  });

  it("rejects a third-party user ID and creates no job", async () => {
    const client = new WebClient();
    const openSpy = mock.method(client.conversations, "open", async () => ({
      ok: true,
      channel: { id: "D_OTHER" },
    }));

    const ctx = buildCtx({ slackClient: client });
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);

    const result = await callHandler(tool, {
      channel: "U999",
      prompt: "malicious dm",
    });

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /can only DM the requesting user/);
    assert.equal(openSpy.mock.callCount(), 0, "should not open a DM with a third party");

    const jobs = await getJobs();
    assert.equal(jobs.length, 0, "no job should be created when the target is rejected");
  });

  it("rejects invalid requiredTools with a validation error listing the bad entries", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await tool.handler(
      {
        name: "Test",
        channel: "C456",
        minute: "0",
        hour: "9",
        dayOfMonth: "*",
        month: "*",
        dayOfWeek: "*",
        timezone: "America/New_York",
        prompt: "test",
        requiredTools: ["mcp__clack__not_a_real_tool", "bare_name_missing_prefix"],
        oneShot: undefined,
        plugin: undefined,
        skipConditions: undefined,
        submitResponseMode: undefined,
      },
      { sessionId: "test" },
    );

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /Invalid requiredTools/);
    assert.match(toolResultText(result), /mcp__clack__not_a_real_tool/);
    assert.match(toolResultText(result), /bare_name_missing_prefix/);
    const jobs = await getJobs();
    assert.equal(jobs.length, 0, "invalid requiredTools should prevent the job from being saved");
  });

  it("accepts valid requiredTools and saves the job", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result: ToolHandlerResult = await tool.handler(
      {
        name: "Test",
        channel: "C456",
        minute: "0",
        hour: "9",
        dayOfMonth: "*",
        month: "*",
        dayOfWeek: "*",
        timezone: "America/New_York",
        prompt: "test",
        requiredTools: ["mcp__clack__fetch_channel_messages"],
        oneShot: undefined,
        plugin: undefined,
        skipConditions: undefined,
        submitResponseMode: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result as any);
    assert.equal(parsed.ok, true);
    const jobs = await getJobs();
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0].requiredTools, ["mcp__clack__fetch_channel_messages"]);
  });

  it("persists skipConditions when supplied", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "C456",
      prompt: "Summarize merged PRs",
      skipConditions: "Skip if no PRs were merged in the last 24 hours.",
    });

    const parsed = parseToolResult(result as any);
    assert.equal(parsed.ok, true);

    const jobs = await getJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].skipConditions, "Skip if no PRs were merged in the last 24 hours.");
  });

  it("omits skipConditions when not supplied", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    await callHandler(tool, {
      channel: "C456",
      prompt: "no conditions",
    });

    const jobs = await getJobs();
    assert.equal(jobs[0].skipConditions, undefined);
  });

  it("persists submitResponseMode when supplied", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "C456",
      prompt: "post a thing",
      submitResponseMode: "skipped",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.submitResponseMode, "skipped");

    const jobs = await getJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].submitResponseMode, "skipped");
  });

  it("omits submitResponseMode from the saved record when not supplied", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    await callHandler(tool, {
      channel: "C456",
      prompt: "default mode",
    });

    const jobs = await getJobs();
    assert.equal(jobs[0].submitResponseMode, undefined);
  });

  it("persists the name on the saved job", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    await callHandler(tool, {
      channel: "C456",
      prompt: "x",
      name: "Morning PR roundup",
    });

    const jobs = await getJobs();
    assert.equal(jobs[0].name, "Morning PR roundup");
  });

  it("returns the name in the tool result", async () => {
    const ctx = buildCtx();
    const deps = makeDeps();
    const tool = createCreateScheduledMessageTool(ctx, deps);
    const result = await callHandler(tool, {
      channel: "C456",
      prompt: "x",
      name: "Daily standup reminder",
    });

    const block = result.content[0];
    assert.ok(block && typeof block === "object" && "text" in block);
    const text = block.text;
    assert.ok(typeof text === "string");
    assert.match(text, /"name":\s*"Daily standup reminder"/);
  });
});
