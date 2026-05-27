import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRunScheduledMessageNowTool,
  type RunScheduledMessageNowDeps,
} from "./runScheduledMessageNow.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";
import { clearCronJobsCache, createJob, updateJobRunStatus } from "../../cronJobs.js";

const originalCwd = process.cwd;

type RunTool = ReturnType<typeof createRunScheduledMessageNowTool>;
type RunToolArgs = Parameters<RunTool["handler"]>[0];
type RunToolResult = Awaited<ReturnType<RunTool["handler"]>>;

function textAt(result: RunToolResult, index: number): string {
  const block = result.content[index];
  if (!block || !("text" in block) || typeof block.text !== "string") {
    throw new Error(`Expected text content at index ${index}`);
  }
  return block.text;
}

function call(tool: RunTool, args: RunToolArgs): Promise<RunToolResult> {
  return tool.handler(args, { sessionId: "test" });
}

function buildCtx(overrides: Partial<QueryToolContext> = {}): QueryToolContext {
  return {
    mode: "query" as const,
    userId: "U123",
    role: "dev",
    config: {} as QueryToolContext["config"],
    session: { sessionId: "test-session" } as QueryToolContext["session"],
    slackClient: {} as QueryToolContext["slackClient"],
    changesWorkflowEnabled: false,
    cronUserSchedules: true,
    ...overrides,
  } as QueryToolContext;
}

interface DepCalls {
  runJobNow: Array<{ jobId: string; asOf?: string }>;
  chatDelete: Array<{ channel: string; ts: string }>;
}

interface MakeDepsOptions {
  skipped?: boolean;
  responseTs?: string;
  throwRunJobNow?: Error;
  throwChatDelete?: Error;
}

function makeDeps(options: MakeDepsOptions = {}): {
  deps: RunScheduledMessageNowDeps;
  calls: DepCalls;
} {
  const calls: DepCalls = { runJobNow: [], chatDelete: [] };
  const deps: RunScheduledMessageNowDeps = {
    runJobNow: async (job, _client, asOf) => {
      calls.runJobNow.push({ jobId: job.id, asOf: asOf?.toISOString() });
      if (options.throwRunJobNow) throw options.throwRunJobNow;
      return {
        skipped: options.skipped ?? false,
        ...(options.responseTs ? { responseTs: options.responseTs } : {}),
      };
    },
    chatDelete: async (params) => {
      calls.chatDelete.push(params);
      if (options.throwChatDelete) throw options.throwChatDelete;
    },
  };
  return { deps, calls };
}

describe("runScheduledMessageNow tool", () => {
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

  it("runs own job (plain run-now)", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
    });

    const { deps, calls } = makeDeps({ responseTs: "1234567890.111111" });
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, { id: job.id, asOf: undefined, replaceResponseTs: undefined });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.id, job.id);
    assert.equal(parsed.skipped, false);
    assert.equal(parsed.responseTs, "1234567890.111111");
    assert.equal(parsed.asOf, undefined);
    assert.equal(calls.runJobNow.length, 1);
    assert.equal(calls.runJobNow[0].asOf, undefined);
    assert.equal(calls.chatDelete.length, 0);
  });

  it("forwards asOf to runJobNow when provided", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
    });

    const { deps, calls } = makeDeps({ responseTs: "1234567890.222222" });
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, {
      id: job.id,
      asOf: "2026-05-08T09:00:00.000Z",
      replaceResponseTs: undefined,
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.asOf, "2026-05-08T09:00:00.000Z");
    assert.equal(calls.runJobNow.length, 1);
    assert.equal(calls.runJobNow[0].asOf, "2026-05-08T09:00:00.000Z");
  });

  it("deletes prior bot post when replaceResponseTs matches a run", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
    });
    await updateJobRunStatus(job.id, "success", "9999.0001");

    const { deps, calls } = makeDeps({ responseTs: "9999.0002" });
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, {
      id: job.id,
      asOf: undefined,
      replaceResponseTs: "9999.0001",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.replacedPriorPost, true);
    assert.equal(parsed.replaceError, undefined);
    assert.equal(calls.chatDelete.length, 1);
    assert.equal(calls.chatDelete[0].channel, "C1");
    assert.equal(calls.chatDelete[0].ts, "9999.0001");
    assert.equal(calls.runJobNow.length, 1);
  });

  it("rejects replaceResponseTs that does not belong to the job", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
    });
    await updateJobRunStatus(job.id, "success", "9999.0001");

    const { deps, calls } = makeDeps();
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, {
      id: job.id,
      asOf: undefined,
      replaceResponseTs: "8888.0001",
    });

    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /does not match any run/);
    assert.equal(calls.chatDelete.length, 0);
    assert.equal(calls.runJobNow.length, 0);
  });

  it("runs a channelless job (plain run-now, no replace)", async () => {
    const job = await createJob({
      cronExpression: "*/15 9-16 * * 1-5",
      // no channel — channelless
      prompt: "Casual chatter",
      createdBy: null,
      systemActor: "plugin:casual-talk",
      plugin: "casual-talk",
      pluginManaged: true,
      specKey: "chatter",
      timezone: "UTC",
    });

    const { deps, calls } = makeDeps({ responseTs: "9999.0001" });
    // Admin role — system-owned jobs require admin or creator (creator is null here).
    const tool = createRunScheduledMessageNowTool(buildCtx({ role: "admin" }), deps);
    const result = await call(tool, { id: job.id, asOf: undefined, replaceResponseTs: undefined });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.id, job.id);
    assert.equal(parsed.skipped, false);
    assert.equal(parsed.responseTs, "9999.0001");
    assert.equal(calls.runJobNow.length, 1, "runJobNow invoked for channelless job");
    assert.equal(calls.runJobNow[0].jobId, job.id);
    assert.equal(calls.chatDelete.length, 0, "no delete for plain run-now");
  });

  it("rejects replaceResponseTs on a channelless job (prior post's channel is not knowable)", async () => {
    const job = await createJob({
      cronExpression: "*/15 9-16 * * 1-5",
      // no channel — channelless
      prompt: "Casual chatter",
      createdBy: null,
      systemActor: "plugin:casual-talk",
      plugin: "casual-talk",
      pluginManaged: true,
      specKey: "chatter",
      timezone: "UTC",
    });
    await updateJobRunStatus(job.id, "success", "9999.0001");

    // Admin role — system-owned jobs require admin or creator (creator is null here).
    const { deps, calls } = makeDeps();
    const tool = createRunScheduledMessageNowTool(buildCtx({ role: "admin" }), deps);
    const result = await call(tool, {
      id: job.id,
      asOf: undefined,
      replaceResponseTs: "9999.0001",
    });

    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /channelless/);
    assert.equal(calls.chatDelete.length, 0, "no delete attempted for channelless");
    assert.equal(calls.runJobNow.length, 0, "no run fired");
  });

  it("reports replaceError but still fires when delete fails", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
    });
    await updateJobRunStatus(job.id, "success", "9999.0001");

    const { deps, calls } = makeDeps({
      responseTs: "9999.0002",
      throwChatDelete: new Error("message_not_found"),
    });
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, {
      id: job.id,
      asOf: undefined,
      replaceResponseTs: "9999.0001",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.replacedPriorPost, false);
    assert.match(parsed.replaceError, /message_not_found/);
    assert.equal(calls.runJobNow.length, 1, "run still fires after best-effort delete");
  });

  it("rejects non-creator non-admin", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Summarize PRs",
      createdBy: "UOTHER",
      timezone: "UTC",
    });

    const { deps } = makeDeps();
    const tool = createRunScheduledMessageNowTool(buildCtx({ role: "dev" }), deps);
    const result = await call(tool, { id: job.id, asOf: undefined, replaceResponseTs: undefined });

    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /only run your own/);
  });

  it("allows admin to run anyone's job", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Summarize PRs",
      createdBy: "UOTHER",
      timezone: "UTC",
    });

    const { deps, calls } = makeDeps();
    const tool = createRunScheduledMessageNowTool(buildCtx({ role: "admin" }), deps);
    const result = await call(tool, { id: job.id, asOf: undefined, replaceResponseTs: undefined });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(calls.runJobNow.length, 1);
  });

  it("returns error for non-existent job", async () => {
    const { deps } = makeDeps();
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, {
      id: "nonexistent",
      asOf: undefined,
      replaceResponseTs: undefined,
    });

    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /not found/);
  });

  it("flags expectedSkip when job has submitResponseMode:'skipped' and outcome skipped", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Post trivia questions",
      createdBy: "U123",
      timezone: "UTC",
      submitResponseMode: "skipped",
    });

    const { deps } = makeDeps({ skipped: true });
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, { id: job.id, asOf: undefined, replaceResponseTs: undefined });

    const parsed = parseToolResult(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.skipped, true);
    assert.equal(parsed.expectedSkip, true);
    assert.match(parsed.note, /designed terminator behavior/);
  });

  it("does not flag expectedSkip when job has no submitResponseMode and outcome skipped", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
    });

    const { deps } = makeDeps({ skipped: true });
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, { id: job.id, asOf: undefined, replaceResponseTs: undefined });

    const parsed = parseToolResult(result);
    assert.equal(parsed.skipped, true);
    assert.equal(parsed.expectedSkip, undefined);
    assert.equal(parsed.note, undefined);
  });

  it("does not flag expectedSkip on submitResponseMode:'skipped' jobs when not skipped", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Post trivia questions",
      createdBy: "U123",
      timezone: "UTC",
      submitResponseMode: "skipped",
    });

    const { deps } = makeDeps({ skipped: false, responseTs: "1.2" });
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, { id: job.id, asOf: undefined, replaceResponseTs: undefined });

    const parsed = parseToolResult(result);
    assert.equal(parsed.skipped, false);
    assert.equal(parsed.expectedSkip, undefined);
  });

  it("rejects invalid asOf", async () => {
    const job = await createJob({
      cronExpression: "0 9 * * *",
      channel: "C1",
      prompt: "Summarize PRs",
      createdBy: "U123",
      timezone: "UTC",
    });

    const { deps, calls } = makeDeps();
    const tool = createRunScheduledMessageNowTool(buildCtx(), deps);
    const result = await call(tool, {
      id: job.id,
      asOf: "not-a-date",
      replaceResponseTs: undefined,
    });

    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /Invalid asOf/);
    assert.equal(calls.runJobNow.length, 0);
  });
});
