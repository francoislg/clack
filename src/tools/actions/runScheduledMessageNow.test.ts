import { describe, it, beforeEach, afterEach } from "node:test";
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
    allowScheduledMessages: true,
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
