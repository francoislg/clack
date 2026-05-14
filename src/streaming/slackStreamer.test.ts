import { describe, it, beforeEach, afterEach, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { TaskUpdateChunk } from "@slack/types";
import {
  SlackStreamer,
  finalizeStreamedWorkflow,
  fmtElapsed,
  type SlackStreamerLogger,
} from "./slackStreamer.js";
import type { StreamEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Shared mock logger — injected via SlackStreamerOptions.logger
// ---------------------------------------------------------------------------

type LoggerCall = readonly unknown[];

interface LoggerRecorder {
  warnCalls: LoggerCall[];
  errorCalls: LoggerCall[];
  logger: SlackStreamerLogger;
  reset(): void;
}

function makeLoggerRecorder(): LoggerRecorder {
  const recorder: LoggerRecorder = {
    warnCalls: [],
    errorCalls: [],
    logger: {
      warn: (...args) => {
        recorder.warnCalls.push(args);
      },
      error: (...args) => {
        recorder.errorCalls.push(args);
      },
    },
    reset() {
      recorder.warnCalls.length = 0;
      recorder.errorCalls.length = 0;
    },
  };
  return recorder;
}

const mockLogger = makeLoggerRecorder();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockChatStreamer {
  append: ReturnType<typeof mock.fn>;
  stop: ReturnType<typeof mock.fn>;
}

function makeMockChatStreamer(): MockChatStreamer {
  return {
    append: mock.fn(async () => {}),
    stop: mock.fn(async () => {}),
  };
}

function makeClient(opts?: {
  chatStreamer?: MockChatStreamer;
  teamId?: string;
  throwOnChatStream?: boolean;
}): App["client"] {
  const streamer = opts?.chatStreamer ?? makeMockChatStreamer();

  return {
    chatStream: opts?.throwOnChatStream
      ? () => {
          throw new Error("chatStream failed");
        }
      : () => streamer,
    auth: {
      test: async () => ({ team_id: opts?.teamId ?? "T_TEAM" }),
    },
    chat: {
      postMessage: mock.fn(async () => ({ ok: true })),
      update: mock.fn(async () => ({ ok: true })),
    },
  } as unknown as App["client"];
}

interface PostMessageCallArgs {
  channel?: string;
  thread_ts?: string;
  text?: string;
}

interface MockedPostMessageHandle {
  mock: {
    callCount(): number;
    calls: ReadonlyArray<{ arguments: ReadonlyArray<PostMessageCallArgs> }>;
  };
}

function assertIsMockedPostMessage(fn: object): asserts fn is MockedPostMessageHandle {
  const maybeMock = (fn as { mock?: unknown }).mock;
  if (
    !maybeMock ||
    typeof maybeMock !== "object" ||
    typeof (maybeMock as { callCount?: unknown }).callCount !== "function"
  ) {
    throw new Error("expected mock fn");
  }
}

/** Extract all chunks sent via append calls. */
function getAppendedChunks(streamer: MockChatStreamer): TaskUpdateChunk[] {
  const chunks: TaskUpdateChunk[] = [];
  for (const call of streamer.append.mock.calls) {
    const arg = call.arguments[0] as { chunks: TaskUpdateChunk[] };
    if (arg?.chunks) chunks.push(...arg.chunks);
  }
  return chunks;
}

/** Find a chunk by its id. */
function findChunk(chunks: TaskUpdateChunk[], id: string): TaskUpdateChunk | undefined {
  return chunks.find((c) => c.id === id);
}

/** Find all chunks matching an id. */
function findChunks(chunks: TaskUpdateChunk[], id: string): TaskUpdateChunk[] {
  return chunks.filter((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// SlackStreamer.start()
// ---------------------------------------------------------------------------

describe("SlackStreamer.start", () => {
  it("starts a chat stream and shows initial thinking task", async () => {
    const mockStreamer = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamer });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    const result = await streamer.start();

    assert.equal(result, true);
    assert.equal(streamer.hasFailed, false);

    // Should have appended the initial thinking task
    const chunks = getAppendedChunks(mockStreamer);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].id, "__thinking__");
    assert.equal(chunks[0].title, "Acknowledged, working on it\u2026");
    assert.equal(chunks[0].status, "in_progress");
  });

  it("returns false and marks failed when chatStream throws", async () => {
    const client = makeClient({ throwOnChatStream: true });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    const result = await streamer.start();

    assert.equal(result, false);
    assert.equal(streamer.hasFailed, true);
  });

  it("fetches team ID from auth.test when not provided", async () => {
    const mockStreamer = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamer, teamId: "T_FETCHED" });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      // no teamId provided
      logger: mockLogger.logger,
    });

    const result = await streamer.start();
    assert.equal(result, true);
  });

  it("captures message ts from first append response", async () => {
    const mockStreamer = makeMockChatStreamer();
    mockStreamer.append = mock.fn(async () => ({ ok: true, ts: "1111.2222" }));
    const client = makeClient({ chatStreamer: mockStreamer });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    assert.equal(streamer.getMessageTs(), undefined);
    await streamer.start();
    assert.equal(streamer.getMessageTs(), "1111.2222");
  });

  it("returns undefined messageTs when start fails", async () => {
    const client = makeClient({ throwOnChatStream: true });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();
    assert.equal(streamer.getMessageTs(), undefined);
  });
});

// ---------------------------------------------------------------------------
// SlackStreamer.handleEvent — tool_start
// ---------------------------------------------------------------------------

describe("SlackStreamer.handleEvent — tool_start", () => {
  let mockStreamerObj: MockChatStreamer;
  let streamer: InstanceType<typeof SlackStreamer>;

  beforeEach(async () => {
    mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();
    // Reset to ignore the initial thinking append
    mockStreamerObj.append.mock.resetCalls();
  });

  it("creates a task for a standalone tool", () => {
    const event: StreamEvent = {
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    };

    streamer.handleEvent(event);

    const chunks = getAppendedChunks(mockStreamerObj);
    // Should have the thinking update + the tool task
    const thinkingUpdate = findChunk(chunks, "__thinking__");
    assert.ok(thinkingUpdate);
    assert.equal(thinkingUpdate!.title, "Analyzing\u2026");

    const toolTask = findChunk(chunks, "task-1");
    assert.ok(toolTask);
    assert.equal(toolTask!.title, "Listing repositories");
    assert.equal(toolTask!.status, "in_progress");
  });

  it("skips tools that return null labels (e.g., submit_response)", () => {
    const event: StreamEvent = {
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__submit_response",
      toolArgs: {},
    };

    streamer.handleEvent(event);

    const chunks = getAppendedChunks(mockStreamerObj);
    assert.equal(chunks.length, 0);
  });

  it("groups consecutive Read/Glob/Grep into a single search task", () => {
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "Read",
      toolArgs: { file_path: "/src/index.ts" },
    });

    // Reset to see chunks from next event
    mockStreamerObj.append.mock.resetCalls();

    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-2",
      toolName: "Grep",
      toolArgs: { pattern: "hello" },
    });

    const chunks = getAppendedChunks(mockStreamerObj);
    // Second tool should reuse the same Slack task ID (task-1)
    const groupTask = findChunk(chunks, "task-1");
    assert.ok(groupTask);
    assert.ok(groupTask!.title!.includes("Searching codebase"));
    assert.ok(groupTask!.title!.includes("(2)"));
  });

  it("creates a new task when tool group key changes", () => {
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "Read",
      toolArgs: { file_path: "/src/index.ts" },
    });

    mockStreamerObj.append.mock.resetCalls();

    // Different group: Edit
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-2",
      toolName: "Edit",
      toolArgs: { file_path: "/src/foo.ts" },
    });

    const chunks = getAppendedChunks(mockStreamerObj);
    const editTask = findChunk(chunks, "task-2");
    assert.ok(editTask);
    assert.ok(editTask!.title!.includes("Editing"));
  });

  it("does nothing when streamer is stopped", async () => {
    await streamer.stop();
    mockStreamerObj.append.mock.resetCalls();

    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    assert.equal(mockStreamerObj.append.mock.callCount(), 0);
  });

  it("does nothing when streamer has failed", async () => {
    // Simulate failure
    mockStreamerObj.append.mock.mockImplementation(async () => {
      throw new Error("append failed");
    });
    streamer.handleEvent({
      type: "tool_start",
      taskId: "fail-trigger",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    // Allow the async append rejection to settle so `failed` flag gets set
    await new Promise((r) => setTimeout(r, 10));

    // Now it should be failed
    assert.equal(streamer.hasFailed, true);
    mockStreamerObj.append.mock.resetCalls();
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-2",
      toolName: "Grep",
      toolArgs: { pattern: "test" },
    });

    assert.equal(mockStreamerObj.append.mock.callCount(), 0);
  });

  it("updates the thinking task only once on first tool_start", () => {
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    mockStreamerObj.append.mock.resetCalls();

    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-2",
      toolName: "mcp__clack__git_log",
      toolArgs: {},
    });

    const chunks = getAppendedChunks(mockStreamerObj);
    const thinkingChunks = findChunks(chunks, "__thinking__");
    // Thinking should NOT be updated again
    assert.equal(thinkingChunks.length, 0);
  });

  it("updates a standalone tool label on re-emit with real args", () => {
    // First emit with empty args (placeholder)
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "Grep",
      toolArgs: {},
    });

    mockStreamerObj.append.mock.resetCalls();

    // Re-emit with real args (same taskId)
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "Grep",
      toolArgs: { pattern: "findMe" },
    });

    const chunks = getAppendedChunks(mockStreamerObj);
    const updated = findChunk(chunks, "task-1");
    assert.ok(updated);
    assert.ok(updated!.title!.includes("findMe"));
  });
});

// ---------------------------------------------------------------------------
// SlackStreamer.handleEvent — tool_end
// ---------------------------------------------------------------------------

describe("SlackStreamer.handleEvent — tool_end", () => {
  let mockStreamerObj: MockChatStreamer;
  let streamer: InstanceType<typeof SlackStreamer>;

  beforeEach(async () => {
    mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();
    mockStreamerObj.append.mock.resetCalls();
  });

  it("completes a standalone tool task on tool_end", () => {
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    mockStreamerObj.append.mock.resetCalls();

    streamer.handleEvent({ type: "tool_end", taskId: "task-1" });

    const chunks = getAppendedChunks(mockStreamerObj);
    const completed = findChunk(chunks, "task-1");
    assert.ok(completed);
    assert.equal(completed!.status, "complete");
    assert.equal(completed!.title, "Listing repositories");
  });

  it("marks a standalone task as failed with error details", () => {
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    mockStreamerObj.append.mock.resetCalls();

    streamer.handleEvent({
      type: "tool_end",
      taskId: "task-1",
      error: true,
      errorMessage: "Something went wrong",
    });

    const chunks = getAppendedChunks(mockStreamerObj);
    const completed = findChunk(chunks, "task-1");
    assert.ok(completed);
    assert.ok(completed!.title!.includes("(failed)"));
    assert.equal(completed!.details, "Something went wrong");
  });

  it("does not complete a grouped task until all members finish", () => {
    // Start two grouped tasks
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "Read",
      toolArgs: { file_path: "/a.ts" },
    });
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-2",
      toolName: "Read",
      toolArgs: { file_path: "/b.ts" },
    });

    mockStreamerObj.append.mock.resetCalls();

    // End first — group should still be in_progress
    streamer.handleEvent({ type: "tool_end", taskId: "task-1" });

    let chunks = getAppendedChunks(mockStreamerObj);
    let groupTask = findChunk(chunks, "task-1");
    assert.ok(groupTask);
    assert.equal(groupTask!.status, "in_progress");

    mockStreamerObj.append.mock.resetCalls();

    // End second — group should complete
    streamer.handleEvent({ type: "tool_end", taskId: "task-2" });

    chunks = getAppendedChunks(mockStreamerObj);
    groupTask = findChunk(chunks, "task-1");
    assert.ok(groupTask);
    assert.equal(groupTask!.status, "complete");
  });

  it("ignores tool_end for unknown taskId", () => {
    mockStreamerObj.append.mock.resetCalls();

    streamer.handleEvent({ type: "tool_end", taskId: "unknown-task" });

    assert.equal(mockStreamerObj.append.mock.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// SlackStreamer.handleEvent — text
// ---------------------------------------------------------------------------

describe("SlackStreamer.handleEvent — text", () => {
  it("ignores text events (no append)", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();
    mockStreamerObj.append.mock.resetCalls();

    streamer.handleEvent({ type: "text", text: "Hello world" });

    assert.equal(mockStreamerObj.append.mock.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// SlackStreamer.stop
// ---------------------------------------------------------------------------

describe("SlackStreamer.stop", () => {
  it("finalizes the thinking task and calls chatStreamer.stop", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();
    mockStreamerObj.append.mock.resetCalls();

    await streamer.stop();

    const chunks = getAppendedChunks(mockStreamerObj);
    const thinking = findChunk(chunks, "__thinking__");
    assert.ok(thinking);
    assert.equal(thinking!.status, "complete");
    assert.equal(thinking!.title, "Acknowledged, working on it\u2026");

    assert.equal(mockStreamerObj.stop.mock.callCount(), 1);
  });

  it("uses 'Analyzing...' title when thinking was finalized by a tool", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    // Trigger a tool to finalize thinking
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    mockStreamerObj.append.mock.resetCalls();
    await streamer.stop();

    const chunks = getAppendedChunks(mockStreamerObj);
    const thinking = findChunk(chunks, "__thinking__");
    assert.ok(thinking);
    assert.equal(thinking!.title, "Analyzing\u2026");
  });

  it("passes markdownText to chatStreamer.stop", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    await streamer.stop({ markdownText: "Done!" });

    assert.equal(mockStreamerObj.stop.mock.callCount(), 1);
    const stopArgs = mockStreamerObj.stop.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(stopArgs.markdown_text, "Done!");
  });

  it("passes blocks to chatStreamer.stop", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    const blocks = [{ type: "section" as const, text: { type: "mrkdwn" as const, text: "hello" } }];
    await streamer.stop({ blocks });

    const stopArgs = mockStreamerObj.stop.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.deepEqual(stopArgs.blocks, blocks);
  });

  it("is idempotent (calling stop twice does not fail)", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    await streamer.stop();
    await streamer.stop();

    // stop on the chatStreamer should only be called once
    assert.equal(mockStreamerObj.stop.mock.callCount(), 1);
  });

  it("does nothing when start was never called", async () => {
    const streamer = new SlackStreamer({
      client: makeClient(),
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    // Should not throw
    await streamer.stop();
  });

  it("skips chatStreamer.stop when stream has failed", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    // Make append fail so stream is marked failed
    mockStreamerObj.append.mock.mockImplementation(async () => {
      throw new Error("broken");
    });

    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();
    // start's append should have failed, marking it as failed

    await streamer.stop();

    assert.equal(mockStreamerObj.stop.mock.callCount(), 0);
  });

  it("force-completes standalone tasks still tracked in taskSlack", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    // Start a standalone tool but don't end it
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-standalone",
      toolName: "mcp__clack__propose_config_update",
      toolArgs: { config: "test" },
    });

    mockStreamerObj.append.mock.resetCalls();

    await streamer.stop();

    const chunks = getAppendedChunks(mockStreamerObj);
    const standaloneComplete = chunks.find(
      (c) => c.id === "task-standalone" && c.status === "complete",
    );
    assert.ok(standaloneComplete, "standalone task should be force-completed on stop");
  });

  it("force-completes the open group on stop", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    // Start a grouped tool but don't end it
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "Read",
      toolArgs: { file_path: "/a.ts" },
    });

    mockStreamerObj.append.mock.resetCalls();

    await streamer.stop();

    const chunks = getAppendedChunks(mockStreamerObj);
    // Should have a complete chunk for the open group
    const groupComplete = chunks.find((c) => c.id === "task-1" && c.status === "complete");
    assert.ok(groupComplete);
  });
});

// ---------------------------------------------------------------------------
// SlackStreamer.hasFailed
// ---------------------------------------------------------------------------

describe("SlackStreamer.hasFailed", () => {
  it("returns false initially", () => {
    const streamer = new SlackStreamer({
      client: makeClient(),
      channel: "C_CHAN",
      threadTs: "1234.5678",
      logger: mockLogger.logger,
    });
    assert.equal(streamer.hasFailed, false);
  });

  it("returns true after append failure", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    mockStreamerObj.append.mock.mockImplementation(async () => {
      throw new Error("fail");
    });

    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start(); // append will fail
    assert.equal(streamer.hasFailed, true);
  });
});

// ---------------------------------------------------------------------------
// finalizeStreamedWorkflow
// ---------------------------------------------------------------------------

describe("finalizeStreamedWorkflow", () => {
  it("stops the streamer on success", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();
    mockStreamerObj.append.mock.resetCalls();

    await finalizeStreamedWorkflow(
      streamer,
      client,
      "C_CHAN",
      "1234.5678",
      { success: true },
      "Change",
    );

    assert.equal(mockStreamerObj.stop.mock.callCount(), 1);
  });

  it("stops with error message on failure", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    await finalizeStreamedWorkflow(
      streamer,
      client,
      "C_CHAN",
      "1234.5678",
      { success: false, error: "timeout" },
      "Change",
    );

    assert.equal(mockStreamerObj.stop.mock.callCount(), 1);
    const stopArgs = mockStreamerObj.stop.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.ok((stopArgs.markdown_text as string).includes("Change failed: timeout"));
  });

  it("posts fallback message when streamer has failed", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    // Make the streamer fail during start
    mockStreamerObj.append.mock.mockImplementation(async () => {
      throw new Error("broken");
    });

    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start(); // This will fail and mark hasFailed = true

    await finalizeStreamedWorkflow(
      streamer,
      client,
      "C_CHAN",
      "1234.5678",
      { success: false, error: "oops" },
      "Update",
    );

    // Should have fallen back to chat.postMessage
    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const pmArgs = postMessage.mock.calls[0].arguments[0] as {
      channel: string;
      thread_ts: string;
      text: string;
    };
    assert.equal(pmArgs.channel, "C_CHAN");
    assert.equal(pmArgs.thread_ts, "1234.5678");
    assert.ok(pmArgs.text.includes("Update failed: oops"));
  });

  it("posts a success fallback with PR URL when streamer has failed mid-run", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    mockStreamerObj.append.mock.mockImplementation(async () => {
      throw new Error("broken");
    });
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    await finalizeStreamedWorkflow(
      streamer,
      client,
      "C_CHAN",
      "1234.5678",
      { success: true, prUrl: "https://example.com/pull/42" },
      "Change request",
    );

    const pm = client.chat.postMessage;
    assertIsMockedPostMessage(pm);
    assert.equal(pm.mock.callCount(), 1);
    const text = pm.mock.calls[0]?.arguments[0]?.text ?? "";
    assert.ok(text.includes("Change request complete"));
    assert.ok(text.includes("https://example.com/pull/42"));
  });

  it("does not post a success fallback when the streamer is healthy", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    await finalizeStreamedWorkflow(
      streamer,
      client,
      "C_CHAN",
      "1234.5678",
      { success: true, prUrl: "https://example.com/pull/42" },
      "Change request",
    );

    const pm = client.chat.postMessage;
    assertIsMockedPostMessage(pm);
    assert.equal(pm.mock.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// Stream Keepalive
// ---------------------------------------------------------------------------

describe("SlackStreamer keepalive", () => {
  it("starts a keepalive timer after successful start()", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();
    const appendCountAfterStart = mockStreamerObj.append.mock.callCount();

    // Advance past the keepalive interval (15s)
    t.mock.timers.tick(15_000);

    // Keepalive should have fired one additional append
    assert.equal(mockStreamerObj.append.mock.callCount(), appendCountAfterStart + 1);

    // The keepalive append should be a thinking task update
    const lastCall = mockStreamerObj.append.mock.calls.at(-1);
    const chunks = (lastCall!.arguments[0] as { chunks: TaskUpdateChunk[] }).chunks;
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].id, "__thinking__");
    assert.equal(chunks[0].status, "in_progress");

    await streamer.stop();
  });

  it("sends keepalive at each interval tick", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();
    const appendCountAfterStart = mockStreamerObj.append.mock.callCount();

    // Advance 3 intervals
    t.mock.timers.tick(45_000);

    assert.equal(mockStreamerObj.append.mock.callCount(), appendCountAfterStart + 3);

    await streamer.stop();
  });

  it("clears keepalive on stop()", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();
    await streamer.stop();

    const appendCountAfterStop = mockStreamerObj.append.mock.callCount();

    // Advance past several intervals — no more appends should happen
    t.mock.timers.tick(60_000);

    assert.equal(mockStreamerObj.append.mock.callCount(), appendCountAfterStop);
  });

  it("clears keepalive when stream fails", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();

    // Make append fail on next call (simulating stream expiry)
    mockStreamerObj.append.mock.mockImplementation(async () => {
      throw new Error("stream expired");
    });

    // Trigger a handleEvent to cause the failure
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-fail",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    // Let the async append rejection settle
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(streamer.hasFailed, true);

    const appendCountAfterFail = mockStreamerObj.append.mock.callCount();

    // Advance past several intervals — keepalive should not fire
    t.mock.timers.tick(60_000);

    assert.equal(mockStreamerObj.append.mock.callCount(), appendCountAfterFail);
  });

  it("does not start keepalive when start() fails", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval"] });

    const client = makeClient({ throwOnChatStream: true });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();
    assert.equal(streamer.hasFailed, true);

    // Advance past several intervals — no keepalive should fire
    // (can't easily count appends since chatStream threw, but no errors should occur)
    t.mock.timers.tick(60_000);
  });

  it("does not decorate tasks that finish before the 30s threshold", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();

    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-fast",
      toolName: "Read",
      toolArgs: { file_path: "foo.ts" },
    });

    mockStreamerObj.append.mock.resetCalls();

    // Tick at 15s — task is under threshold, so no decoration emitted
    t.mock.timers.tick(15_000);

    // Complete the task before 30s
    streamer.handleEvent({ type: "tool_end", taskId: "task-fast" });

    // No keepalive decoration should have appended for this task
    const chunks = getAppendedChunks(mockStreamerObj);
    const decorated = chunks.filter((c) => c.title?.includes("⏱"));
    assert.equal(decorated.length, 0);

    await streamer.stop();
  });

  it("decorates a long-running standalone task with timer and appending dots", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();

    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-slow",
      toolName: "Read",
      toolArgs: { file_path: "foo.ts" },
    });

    mockStreamerObj.append.mock.resetCalls();

    // Tick 1: 15s — under threshold, no decoration
    t.mock.timers.tick(15_000);
    let chunks = getAppendedChunks(mockStreamerObj);
    assert.equal(chunks.filter((c) => c.title?.includes("⏱")).length, 0);

    // Tick 2: 30s — at threshold, first decoration
    t.mock.timers.tick(15_000);
    chunks = getAppendedChunks(mockStreamerObj);
    const firstDecoration = chunks.filter((c) => c.title?.includes("⏱"));
    assert.equal(firstDecoration.length, 1);
    assert.equal(firstDecoration[0].id, "task-slow");
    assert.match(firstDecoration[0].title!, /⏱ 30s$/);
    assert.equal(firstDecoration[0].details, "\n .");

    // Tick 3: 45s — second decoration, appends single dot
    t.mock.timers.tick(15_000);
    chunks = getAppendedChunks(mockStreamerObj);
    const allDecorations = chunks.filter((c) => c.title?.includes("⏱"));
    assert.equal(allDecorations.length, 2);
    assert.match(allDecorations[1].title!, /⏱ 45s$/);
    assert.equal(allDecorations[1].details, " .");

    await streamer.stop();
  });

  it("decorates parallel tasks independently based on each startedAt", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();

    // Task A starts at t=0
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-A",
      toolName: "Read",
      toolArgs: { file_path: "a.ts" },
    });

    // Task B starts later so it's under threshold when A crosses it
    t.mock.timers.tick(20_000);
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-B",
      toolName: "Grep",
      toolArgs: { pattern: "foo" },
    });

    mockStreamerObj.append.mock.resetCalls();

    // Tick: now at 30s. A has been running 30s (past threshold); B has been running 10s (under).
    t.mock.timers.tick(10_000);

    const chunks = getAppendedChunks(mockStreamerObj);
    const decorated = chunks.filter((c) => c.title?.includes("⏱"));
    assert.equal(decorated.length, 1);
    assert.equal(decorated[0].id, "task-A");

    await streamer.stop();
  });

  it("decorates a grouped task with the current group title including count suffix", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();

    // Start a grouped tool (Read group)
    streamer.handleEvent({
      type: "tool_start",
      taskId: "group-1",
      toolName: "Read",
      toolArgs: { file_path: "a.ts" },
    });
    // Second item joins the group
    streamer.handleEvent({
      type: "tool_start",
      taskId: "group-2",
      toolName: "Read",
      toolArgs: { file_path: "b.ts" },
    });

    mockStreamerObj.append.mock.resetCalls();

    // Advance through two ticks — first is under threshold, second decorates
    t.mock.timers.tick(15_000);
    t.mock.timers.tick(15_000);

    let chunks = getAppendedChunks(mockStreamerObj);
    let decorated = chunks.filter((c) => c.title?.includes("⏱"));
    assert.equal(decorated.length, 1);
    // Group title "Searching codebase" with count (2)
    assert.match(decorated[0].title!, /\(2\) ⏱/);

    // Add a third item and tick again — count should update to (3)
    streamer.handleEvent({
      type: "tool_start",
      taskId: "group-3",
      toolName: "Read",
      toolArgs: { file_path: "c.ts" },
    });
    mockStreamerObj.append.mock.resetCalls();

    t.mock.timers.tick(15_000);
    chunks = getAppendedChunks(mockStreamerObj);
    decorated = chunks.filter((c) => c.title?.includes("⏱"));
    assert.equal(decorated.length, 1);
    assert.match(decorated[0].title!, /\(3\) ⏱/);

    await streamer.stop();
  });

  it("does not reset startedAt when a tool joins an existing group", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();

    streamer.handleEvent({
      type: "tool_start",
      taskId: "group-1",
      toolName: "Read",
      toolArgs: { file_path: "a.ts" },
    });

    // Advance 25s, then add a second item to the group
    t.mock.timers.tick(25_000);
    streamer.handleEvent({
      type: "tool_start",
      taskId: "group-2",
      toolName: "Read",
      toolArgs: { file_path: "b.ts" },
    });

    mockStreamerObj.append.mock.resetCalls();

    // Advance 5 more seconds to reach 30s total — should still decorate
    t.mock.timers.tick(5_000);

    const chunks = getAppendedChunks(mockStreamerObj);
    const decorated = chunks.filter((c) => c.title?.includes("⏱"));
    assert.equal(decorated.length, 1, "group should decorate at 30s total, not restart timer");
    assert.match(decorated[0].title!, /⏱ 30s$/);

    await streamer.stop();
  });

  it("still pings the thinking task when no tasks are active", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();
    mockStreamerObj.append.mock.resetCalls();

    // Tick with no active tasks
    t.mock.timers.tick(15_000);

    const chunks = getAppendedChunks(mockStreamerObj);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].id, "__thinking__");
    assert.equal(chunks[0].status, "in_progress");

    await streamer.stop();
  });
});

describe("fmtElapsed", () => {
  it("formats sub-minute durations as seconds", () => {
    assert.equal(fmtElapsed(0), "0s");
    assert.equal(fmtElapsed(1_000), "1s");
    assert.equal(fmtElapsed(45_000), "45s");
    assert.equal(fmtElapsed(59_999), "59s");
  });

  it("formats sub-10-minute durations with minutes and seconds", () => {
    assert.equal(fmtElapsed(60_000), "1m 0s");
    assert.equal(fmtElapsed(65_000), "1m 5s");
    assert.equal(fmtElapsed(125_000), "2m 5s");
    assert.equal(fmtElapsed(599_000), "9m 59s");
  });

  it("drops seconds once minutes >= 10", () => {
    assert.equal(fmtElapsed(600_000), "10m");
    assert.equal(fmtElapsed(900_000), "15m");
    assert.equal(fmtElapsed(930_000), "15m"); // 15m 30s → "15m"
    assert.equal(fmtElapsed(3_600_000), "60m");
  });

  it("clamps negative input to 0s", () => {
    assert.equal(fmtElapsed(-1_000), "0s");
  });
});

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

describe("SlackStreamer error classification", () => {
  it("logs message_not_in_streaming_state as warning, not error", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();
    mockLogger.reset();

    // Make append throw the specific Slack error
    const slackError = Object.assign(new Error("message_not_in_streaming_state"), {
      code: "slack_webapi_platform_error",
      data: { ok: false, error: "message_not_in_streaming_state" },
    });
    mockStreamerObj.append.mock.mockImplementation(async () => {
      throw slackError;
    });

    // Trigger an event that will try to append
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    // Let async settle
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(streamer.hasFailed, true);

    // Should have logged as warn, not error
    const expiredWarn = mockLogger.warnCalls.find(
      (c) => typeof c[0] === "string" && c[0].includes("message_not_in_streaming_state"),
    );
    assert.ok(expiredWarn, "Expected a warn log about message_not_in_streaming_state");

    // Warn log should carry diagnostic fields as the second argument
    const diag = expiredWarn[1];
    assert.ok(diag && typeof diag === "object", "Expected diagnostic object on warn call");
    assert.ok("msSinceLastTick" in diag && typeof diag.msSinceLastTick === "number");
    assert.ok("msSinceLastEvent" in diag && typeof diag.msSinceLastEvent === "number");
    assert.ok("activeTaskCount" in diag && typeof diag.activeTaskCount === "number");

    // error logger should NOT have been called for 'Failed to append' for this specific error
    const failedAppendError = mockLogger.errorCalls.find(
      (c) => typeof c[0] === "string" && c[0].includes("Failed to append"),
    );
    assert.equal(
      failedAppendError,
      undefined,
      "Should not log 'Failed to append' at error level for stream expiry",
    );
  });

  it("logs message_not_found as warning, not error", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();
    mockLogger.reset();

    const slackError = Object.assign(new Error("message_not_found"), {
      code: "slack_webapi_platform_error",
      data: { ok: false, error: "message_not_found" },
    });
    mockStreamerObj.append.mock.mockImplementation(async () => {
      throw slackError;
    });

    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    await new Promise((r) => setTimeout(r, 10));

    assert.equal(streamer.hasFailed, true);

    const notFoundWarn = mockLogger.warnCalls.find(
      (c) => typeof c[0] === "string" && c[0].includes("message_not_found"),
    );
    assert.ok(notFoundWarn, "Expected a warn log about message_not_found");

    const failedAppendError = mockLogger.errorCalls.find(
      (c) => typeof c[0] === "string" && c[0].includes("Failed to append"),
    );
    assert.equal(
      failedAppendError,
      undefined,
      "Should not log 'Failed to append' at error level when the placeholder message is gone",
    );
  });

  it("still logs other append errors at error level", async () => {
    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });

    await streamer.start();
    mockLogger.reset();

    // Make append throw a generic error (not stream expiry)
    mockStreamerObj.append.mock.mockImplementation(async () => {
      throw new Error("some other error");
    });

    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-1",
      toolName: "mcp__clack__list_repositories",
      toolArgs: {},
    });

    await new Promise((r) => setTimeout(r, 10));

    assert.equal(streamer.hasFailed, true);

    const failedAppendError = mockLogger.errorCalls.find(
      (c) => typeof c[0] === "string" && c[0].includes("Failed to append"),
    );
    assert.ok(failedAppendError, "Generic errors should still be logged at error level");
  });
});

// ---------------------------------------------------------------------------
// SlackStreamer.handleEvent — grouped detail cap
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { resetToolMappingCache } from "./toolMappingLoader.js";

const USER_TOOL_MAPPING_DIR_FOR_CAP_TESTS = resolvePath(
  process.cwd(),
  "data/configuration/tool_mapping",
);

/** Count chunks for `slackId` that set a non-empty `details` field. */
function countDetailChunks(chunks: TaskUpdateChunk[], slackId: string): number {
  return chunks.filter(
    (c) => c.id === slackId && typeof c.details === "string" && c.details.length > 0,
  ).length;
}

describe("SlackStreamer.handleEvent — grouped detail cap", () => {
  let mockStreamerObj: MockChatStreamer;
  let streamer: InstanceType<typeof SlackStreamer>;

  beforeEach(async () => {
    mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();
    mockStreamerObj.append.mock.resetCalls();
  });

  it("renders one detail line per call up to the default cap of 5", () => {
    for (let i = 1; i <= 5; i++) {
      streamer.handleEvent({
        type: "tool_start",
        taskId: `task-${i}`,
        toolName: "Read",
        toolArgs: { file_path: `/file${i}.ts` },
      });
    }

    const chunks = getAppendedChunks(mockStreamerObj);
    assert.equal(
      countDetailChunks(chunks, "task-1"),
      5,
      "5 calls under cap should each emit a detail line",
    );

    // Header reflects 5 calls
    const lastTaskChunk = [...chunks].reverse().find((c) => c.id === "task-1");
    assert.ok(lastTaskChunk);
    assert.ok(
      lastTaskChunk!.title!.includes("(5)"),
      `expected "(5)" in title, got "${lastTaskChunk!.title}"`,
    );
  });

  it("emits one '…' overflow marker at cap+1, then stays silent while header keeps climbing", () => {
    // 10 calls into a default-cap-of-5 group. The overflow marker must fire at call #6
    // and NEVER fire again for calls #7-10 — exactly one marker total.
    for (let i = 1; i <= 10; i++) {
      streamer.handleEvent({
        type: "tool_start",
        taskId: `task-${i}`,
        toolName: "Read",
        toolArgs: { file_path: `/file${i}.ts` },
      });
    }

    const chunks = getAppendedChunks(mockStreamerObj);
    const detailChunks = chunks.filter(
      (c) => c.id === "task-1" && typeof c.details === "string" && c.details.length > 0,
    );

    // 5 in-cap detail lines + 1 overflow marker = 6 detail-bearing chunks, no more.
    assert.equal(
      detailChunks.length,
      6,
      "5 in-cap details + exactly 1 overflow marker (silent for calls 7–10)",
    );

    // Exactly one "…" line — not one per overflow call.
    const markerChunks = detailChunks.filter((c) => c.details!.includes("…"));
    assert.equal(
      markerChunks.length,
      1,
      `overflow marker must fire exactly once, got ${markerChunks.length}`,
    );

    // The marker is the 6th (and last) detail-bearing chunk.
    assert.ok(detailChunks[detailChunks.length - 1].details!.includes("…"));

    // Header reflects all 10 calls.
    const lastTaskChunk = [...chunks].reverse().find((c) => c.id === "task-1");
    assert.ok(lastTaskChunk);
    assert.ok(
      lastTaskChunk!.title!.includes("(10)"),
      `header count should keep climbing past cap; got "${lastTaskChunk!.title}"`,
    );
  });
});

describe("SlackStreamer.handleEvent — grouped detail cap with custom mapping", () => {
  const overrideFile = resolvePath(USER_TOOL_MAPPING_DIR_FOR_CAP_TESTS, "testcap.json");

  beforeEach(() => {
    mkdirSync(USER_TOOL_MAPPING_DIR_FOR_CAP_TESTS, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(overrideFile)) rmSync(overrideFile);
    resetToolMappingCache();
  });

  it("renders header-only when maxDetails is 0", async () => {
    writeFileSync(
      overrideFile,
      JSON.stringify({
        tools: {
          do_thing: { label: "Doing thing {id}", group: "noisy", itemDetail: "{id}" },
        },
        groups: {
          noisy: { title: "Doing noisy work", maxDetails: 0 },
        },
      }),
    );
    resetToolMappingCache();

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();
    mockStreamerObj.append.mock.resetCalls();

    for (let i = 1; i <= 3; i++) {
      streamer.handleEvent({
        type: "tool_start",
        taskId: `task-${i}`,
        toolName: "mcp__testcap__do_thing",
        toolArgs: { id: `item-${i}` },
      });
    }

    const chunks = getAppendedChunks(mockStreamerObj);
    assert.equal(
      countDetailChunks(chunks, "task-1"),
      0,
      "maxDetails: 0 must produce zero detail lines",
    );

    const lastTaskChunk = [...chunks].reverse().find((c) => c.id === "task-1");
    assert.ok(lastTaskChunk);
    assert.ok(
      lastTaskChunk!.title!.includes("(3)"),
      "header count must still climb when detail lines are suppressed",
    );
  });

  it("two groups in the same stream cap independently", async () => {
    writeFileSync(
      overrideFile,
      JSON.stringify({
        tools: {
          tight: { label: "Tight {id}", group: "small", itemDetail: "{id}" },
          loose: { label: "Loose {id}", group: "big", itemDetail: "{id}" },
        },
        groups: {
          small: { title: "Tight group", maxDetails: 3 },
          big: { title: "Loose group", maxDetails: 10 },
        },
      }),
    );
    resetToolMappingCache();

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();
    mockStreamerObj.append.mock.resetCalls();

    // 5 "tight" calls (cap 3) — should produce only 3 detail lines under one task
    for (let i = 1; i <= 5; i++) {
      streamer.handleEvent({
        type: "tool_start",
        taskId: `tight-${i}`,
        toolName: "mcp__testcap__tight",
        toolArgs: { id: `s-${i}` },
      });
    }
    // Switching to "loose" opens a new group task
    for (let i = 1; i <= 5; i++) {
      streamer.handleEvent({
        type: "tool_start",
        taskId: `loose-${i}`,
        toolName: "mcp__testcap__loose",
        toolArgs: { id: `b-${i}` },
      });
    }

    const chunks = getAppendedChunks(mockStreamerObj);
    // Tight: 3 in-cap details + 1 overflow marker; loose: 5 calls, well under cap (10), no marker.
    assert.equal(
      countDetailChunks(chunks, "tight-1"),
      4,
      "tight group: 3 in-cap details + 1 overflow marker",
    );
    assert.equal(
      countDetailChunks(chunks, "loose-1"),
      5,
      "loose group should emit all 5 detail lines (cap 10)",
    );

    const tightHeader = [...chunks].reverse().find((c) => c.id === "tight-1");
    const looseHeader = [...chunks].reverse().find((c) => c.id === "loose-1");
    assert.ok(tightHeader);
    assert.ok(looseHeader);
    assert.ok(tightHeader!.title!.includes("(5)"));
    assert.ok(looseHeader!.title!.includes("(5)"));
  });

  it("re-emission of grouped details respects the cap when count exceeds it", async () => {
    writeFileSync(
      overrideFile,
      JSON.stringify({
        tools: {
          do_thing: { label: "Doing {id}", group: "capped", itemDetail: "{id}" },
        },
        groups: {
          capped: { title: "Capped group", maxDetails: 2 },
        },
      }),
    );
    resetToolMappingCache();

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger.logger,
    });
    await streamer.start();

    // Three calls with real args — first 2 should emit detail lines, 3rd should be suppressed.
    for (let i = 1; i <= 3; i++) {
      streamer.handleEvent({
        type: "tool_start",
        taskId: `task-${i}`,
        toolName: "mcp__testcap__do_thing",
        toolArgs: { id: `item-${i}` },
      });
    }
    // 4th: tool_progress (empty args) then re-emit with real args — should NOT add a detail line
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-4",
      toolName: "mcp__testcap__do_thing",
      toolArgs: {},
    });
    mockStreamerObj.append.mock.resetCalls();
    streamer.handleEvent({
      type: "tool_start",
      taskId: "task-4",
      toolName: "mcp__testcap__do_thing",
      toolArgs: { id: "item-4" },
    });

    const reemissionChunks = getAppendedChunks(mockStreamerObj);
    const reemittedDetail = reemissionChunks.find(
      (c) => c.id === "task-1" && typeof c.details === "string" && c.details.length > 0,
    );
    assert.equal(reemittedDetail, undefined, "re-emission past cap must not append a detail line");
  });
});
