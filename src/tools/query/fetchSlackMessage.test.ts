import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockExtractMessageText = mock.fn<(...args: unknown[]) => string>();
const mockFetchThreadContext = mock.fn<(...args: unknown[]) => Promise<unknown[]>>();

mock.module("../../slack/messagesApi.js", {
  namedExports: {
    extractMessageText: mockExtractMessageText,
    fetchThreadContext: mockFetchThreadContext,
  },
});

const mockExtractImageFiles = mock.fn<(...args: unknown[]) => unknown[]>();

mock.module("../../slack/imageExtractor.js", {
  namedExports: {
    extractImageFiles: mockExtractImageFiles,
  },
});

// Import after mocks
const { createFetchSlackMessageTool } = await import("./fetchSlackMessage.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";
import type { SlackImageFile } from "../../slack/slackFileBase.js";

function makeSlackClient(responses?: { replies?: unknown; history?: unknown }) {
  return {
    conversations: {
      replies: mock.fn(async () => responses?.replies ?? { messages: [] }),
      history: mock.fn(async () => responses?.history ?? { messages: [] }),
    },
  } as unknown as NonNullable<QueryToolContext["slackClient"]>;
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
    allowScheduledMessages: false,
    slackClient: makeSlackClient(),
    availableImages: new Map(),
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockExtractMessageText.mock.resetCalls();
  mockFetchThreadContext.mock.resetCalls();
  mockExtractImageFiles.mock.resetCalls();

  mockExtractMessageText.mock.mockImplementation(() => "Hello world");
  mockFetchThreadContext.mock.mockImplementation(async () => []);
  mockExtractImageFiles.mock.mockImplementation(() => []);
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
    mockExtractMessageText.mock.mockImplementation(() => "Hello from Slack!");
    const client = makeSlackClient({
      history: { messages: [{ ts: "1234567890.123456", text: "Hello from Slack!" }] },
    });

    const ctx = makeCtx({ slackClient: client });
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

  it("returns error when message is not found", async () => {
    mockExtractMessageText.mock.mockImplementation(() => "");
    const client = makeSlackClient({
      history: { messages: [{ ts: "9999999999.000000" }] },
    });

    const ctx = makeCtx({ slackClient: client });
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
    assert.equal(parsed.messages[1].user, "bob");
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

  // --- Image discovery ---

  it("includes images from thread messages and registers them", async () => {
    const imageFile = { id: "F123", name: "screenshot.png", mimetype: "image/png", size: 1024, url_private: "https://example.com/img" };
    const threadMessages = [
      { text: "Check this", userId: "U1", ts: "1.0", isBot: false, imageFiles: [imageFile] },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => threadMessages);

    const availableImages = new Map<string, SlackImageFile>();
    const ctx = makeCtx({ availableImages });
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: true,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].images[0].file_id, "F123");
    assert.ok(availableImages.has("F123"));
  });

  it("includes images from single message and registers them", async () => {
    const imageFile = { id: "F456", name: "photo.jpg", mimetype: "image/jpeg", size: 2048, url_private: "https://example.com/img2" };
    mockExtractMessageText.mock.mockImplementation(() => "Look at this");
    mockExtractImageFiles.mock.mockImplementation(() => [imageFile]);

    const client = makeSlackClient({
      history: { messages: [{ ts: "1234567890.123456", text: "Look at this", files: [{}] }] },
    });

    const availableImages = new Map<string, SlackImageFile>();
    const ctx = makeCtx({ slackClient: client, availableImages });
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      include_thread: undefined,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.images[0].file_id, "F456");
    assert.ok(availableImages.has("F456"));
  });
});
