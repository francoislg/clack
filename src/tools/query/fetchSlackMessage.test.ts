import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockFetchMessage = mock.fn<(...args: unknown[]) => Promise<string>>();
const mockFetchThreadContext = mock.fn<(...args: unknown[]) => Promise<unknown[]>>();

mock.module("../../slack/messagesApi.js", {
  namedExports: {
    fetchMessage: mockFetchMessage,
    fetchThreadContext: mockFetchThreadContext,
  },
});

// Import after mocks
const { createFetchSlackMessageTool } = await import("./fetchSlackMessage.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";

function makeSlackClient() {
  return {} as NonNullable<QueryToolContext["slackClient"]>;
}

function makeCtx(overrides?: Partial<QueryToolContext>): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "dev",
    session: {
      sessionId: "sess-1",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U123",
      originalQuestion: "test",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: {
      repositories: [],
    } as unknown as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    slackClient: makeSlackClient(),
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockFetchMessage.mock.resetCalls();
  mockFetchThreadContext.mock.resetCalls();

  mockFetchMessage.mock.mockImplementation(async () => "Hello world");
  mockFetchThreadContext.mock.mockImplementation(async () => []);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchSlackMessage tool", () => {
  beforeEach(resetMocks);

  // --- URL parsing ---

  it("returns error for invalid URL format", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({ url: "not-a-url", include_thread: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid Slack message URL"));
    assert.equal(result.isError, true);
  });

  it("returns error for non-Slack URL", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({ url: "https://example.com/page", include_thread: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid Slack message URL"));
    assert.equal(result.isError, true);
  });

  it("returns error for Slack URL with wrong path format", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({ url: "https://workspace.slack.com/messages/C123", include_thread: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.equal(result.isError, true);
  });

  // --- slackClient absent ---

  it("returns error when slackClient is not available", async () => {
    const ctx = makeCtx({ slackClient: undefined });
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: undefined,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Slack client is not available"));
    assert.equal(result.isError, true);
  });

  // --- Single message fetch ---

  it("fetches a single message by URL", async () => {
    mockFetchMessage.mock.mockImplementation(async () => "Hello from Slack!");

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: undefined,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.channel, "C0123ABC");
    assert.equal(parsed.ts, "1234567890.123456");
    assert.equal(parsed.text, "Hello from Slack!");
    assert.equal(result.isError, undefined);
  });

  it("parses timestamp correctly from Slack URL", async () => {
    mockFetchMessage.mock.mockImplementation(async () => "msg");

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    await toolDef.handler({
      url: "https://workspace.slack.com/archives/C999/p9876543210654321",
      include_thread: undefined,
    }, { sessionId: "test" });

    // Verify fetchMessage was called with correctly parsed ts
    assert.equal(mockFetchMessage.mock.callCount(), 1);
    const callArgs = mockFetchMessage.mock.calls[0].arguments;
    assert.equal(callArgs[1], "C999"); // channelId
    assert.equal(callArgs[2], "9876543210.654321"); // messageTs — dot after 10th char
  });

  it("returns error when message is not found or empty", async () => {
    mockFetchMessage.mock.mockImplementation(async () => "");

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: undefined,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found or empty"));
    assert.equal(result.isError, true);
  });

  // --- Thread fetch ---

  it("fetches full thread when include_thread is true", async () => {
    const threadMessages = [
      { text: "Parent message", userId: "U1", ts: "1234567890.123456", isBot: false, displayName: "Alice" },
      { text: "Reply 1", userId: "U2", ts: "1234567890.123457", isBot: false, username: "bob" },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => threadMessages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: true,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.channel, "C0123ABC");
    assert.equal(parsed.thread_ts, "1234567890.123456");
    assert.equal(parsed.message_count, 2);
    assert.equal(parsed.messages[0].user, "Alice");
    assert.equal(parsed.messages[0].text, "Parent message");
    assert.equal(parsed.messages[1].user, "bob");
    assert.equal(parsed.messages[1].text, "Reply 1");
  });

  it("returns error when thread fetch returns empty array", async () => {
    mockFetchThreadContext.mock.mockImplementation(async () => []);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: true,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Could not fetch thread"));
    assert.equal(result.isError, true);
  });

  it("uses thread_ts from query param when present in URL", async () => {
    const threadMessages = [
      { text: "Thread parent", userId: "U1", ts: "1111111111.000000", isBot: false, displayName: "Charlie" },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => threadMessages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456?thread_ts=1111111111.000000",
      include_thread: true,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    // Should use the thread_ts from query param as parentTs
    assert.equal(parsed.thread_ts, "1111111111.000000");

    // Verify fetchThreadContext was called with the thread_ts
    assert.equal(mockFetchThreadContext.mock.callCount(), 1);
    const callArgs = mockFetchThreadContext.mock.calls[0].arguments;
    assert.equal(callArgs[1], "C0123ABC");
    assert.equal(callArgs[2], "1111111111.000000"); // parentTs = threadTs from query param
  });

  it("passes threadTs to fetchMessage for single-message fetch with thread context", async () => {
    mockFetchMessage.mock.mockImplementation(async () => "thread reply");

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456?thread_ts=9999999999.000000",
      include_thread: undefined,
    }, { sessionId: "test" });

    assert.equal(mockFetchMessage.mock.callCount(), 1);
    const callArgs = mockFetchMessage.mock.calls[0].arguments;
    assert.equal(callArgs[1], "C0123ABC");
    assert.equal(callArgs[2], "1234567890.123456"); // messageTs
    assert.equal(callArgs[3], "9999999999.000000"); // threadTs from query param
  });

  it("uses userId for display when displayName and username are absent", async () => {
    const threadMessages = [
      { text: "message", userId: "U999", ts: "1234567890.123456", isBot: false },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => threadMessages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: true,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].user, "U999");
  });

  it("prefers displayName over username for thread messages", async () => {
    const threadMessages = [
      { text: "message", userId: "U1", ts: "1.0", isBot: false, displayName: "Alice Display", username: "alice_user" },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => threadMessages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: true,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].user, "Alice Display");
  });

  it("includes is_bot flag for thread messages", async () => {
    const threadMessages = [
      { text: "human", userId: "U1", ts: "1.0", isBot: false },
      { text: "bot reply", userId: "B1", ts: "1.1", isBot: true },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => threadMessages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: true,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].is_bot, false);
    assert.equal(parsed.messages[1].is_bot, true);
  });
});
