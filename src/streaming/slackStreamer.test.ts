import { describe, it, beforeEach, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { TaskUpdateChunk } from "@slack/types";
import { SlackStreamer, finalizeStreamedWorkflow } from "./slackStreamer.js";
import type { StreamEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Shared mock logger — injected via SlackStreamerOptions.logger
// ---------------------------------------------------------------------------

const mockLogger = {
  warn: mock.fn(() => {}),
  error: mock.fn(() => {}),
};

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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
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
      logger: mockLogger,
    });

    await streamer.start();
    assert.equal(streamer.hasFailed, true);

    // Advance past several intervals — no keepalive should fire
    // (can't easily count appends since chatStream threw, but no errors should occur)
    t.mock.timers.tick(60_000);
  });

  it("uses finalized thinking title in keepalive after tool starts", async (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setInterval"] });

    const mockStreamerObj = makeMockChatStreamer();
    const client = makeClient({ chatStreamer: mockStreamerObj });
    const streamer = new SlackStreamer({
      client,
      channel: "C_CHAN",
      threadTs: "1234.5678",
      teamId: "T_TEAM",
      logger: mockLogger,
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

    // Advance to keepalive
    t.mock.timers.tick(15_000);

    const lastCall = mockStreamerObj.append.mock.calls.at(-1);
    const chunks = (lastCall!.arguments[0] as { chunks: TaskUpdateChunk[] }).chunks;
    assert.equal(chunks[0].title, "Analyzing\u2026");

    await streamer.stop();
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
      logger: mockLogger,
    });

    await streamer.start();
    mockLogger.warn.mock.resetCalls();
    mockLogger.error.mock.resetCalls();

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
    const warnCalls = mockLogger.warn.mock.calls as unknown as { arguments: unknown[] }[];
    const warnMessages = warnCalls.map((c) => c.arguments[0] as string);
    assert.ok(
      warnMessages.some((m) => m.includes("message_not_in_streaming_state")),
      "Expected a warn log about message_not_in_streaming_state",
    );

    // error logger should NOT have been called for this specific error
    const errorCalls = mockLogger.error.mock.calls as unknown as { arguments: unknown[] }[];
    const errorMessages = errorCalls.map((c) => c.arguments[0] as string);
    assert.ok(
      !errorMessages.some((m) => m.includes("Failed to append")),
      "Should not log 'Failed to append' at error level for stream expiry",
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
      logger: mockLogger,
    });

    await streamer.start();
    mockLogger.warn.mock.resetCalls();
    mockLogger.error.mock.resetCalls();

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

    const errorCalls = mockLogger.error.mock.calls as unknown as { arguments: unknown[] }[];
    const errorMessages = errorCalls.map((c) => c.arguments[0] as string);
    assert.ok(
      errorMessages.some((m) => m.includes("Failed to append")),
      "Generic errors should still be logged at error level",
    );
  });
});
