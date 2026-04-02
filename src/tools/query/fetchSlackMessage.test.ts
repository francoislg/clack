import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockFetchThreadContext = mock.fn<(...args: unknown[]) => Promise<unknown[]>>();

mock.module("../../slack/messagesApi.js", {
  namedExports: {
    fetchThreadContext: mockFetchThreadContext,
  },
});

// Import after mocks
const { createFetchSlackMessageTool } = await import("./fetchSlackMessage.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";
import type { SlackImageFile } from "../../slack/slackFileBase.js";

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
    slackClient: {} as NonNullable<QueryToolContext["slackClient"]>,
    availableImages: new Map(),
    availableFiles: new Map(),
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function makeThreadMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    text: `Message ${i}`,
    userId: `U${i}`,
    ts: `${i}.0`,
    isBot: false,
    displayName: `User ${i}`,
  }));
}

function resetMocks() {
  mockFetchThreadContext.mock.resetCalls();
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

    const result = await toolDef.handler({ url: "not-a-url" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid Slack message URL"));
    assert.equal(result.isError, true);
  });

  it("returns error for non-Slack URL", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({ url: "https://example.com/page" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid Slack message URL"));
    assert.equal(result.isError, true);
  });

  it("returns error for slack.com URL without workspace subdomain", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({ url: "https://slack.com/archives/C0123ABC/p1234567890123456" }, { sessionId: "test" });

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
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Slack client is not available"));
    assert.equal(result.isError, true);
  });

  // --- Default pagination (5 messages) ---

  it("fetches thread with default pagination of 5 messages", async () => {
    const messages = makeThreadMessages(8);
    mockFetchThreadContext.mock.mockImplementation(async () => messages.slice(0, 6)); // 6 = (0+1)*5+1

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.channel, "C0123ABC");
    assert.equal(parsed.thread_ts, "1234567890.123456");
    assert.equal(parsed.message_count, 5);
    assert.equal(parsed.page, 0);
    assert.equal(parsed.limit, 5);
    assert.equal(parsed.has_more, true);
    assert.equal(parsed.messages.length, 5);
    assert.equal(parsed.messages[0].user, "User 0");
  });

  it("returns has_more false when thread has fewer messages than limit", async () => {
    const messages = makeThreadMessages(3);
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 3);
    assert.equal(parsed.has_more, false);
  });

  // --- Custom page/limit ---

  it("fetches custom page and limit", async () => {
    const messages = makeThreadMessages(25);
    mockFetchThreadContext.mock.mockImplementation(async () => messages.slice(0, 21)); // (1+1)*10+1

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      page: 1,
      limit: 10,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 10);
    assert.equal(parsed.message_count, 10);
    assert.equal(parsed.messages[0].user, "User 10");
    assert.equal(parsed.has_more, true);
  });

  // --- has_more detection ---

  it("detects has_more when thread is longer than page", async () => {
    const messages = makeThreadMessages(6); // exactly limit+1
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 5);
    assert.equal(parsed.has_more, true);
  });

  it("returns has_more false when exactly at limit", async () => {
    const messages = makeThreadMessages(5);
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 5);
    assert.equal(parsed.has_more, false);
  });

  // --- Standalone message (no thread) ---

  it("returns single message for standalone message URL", async () => {
    const messages = makeThreadMessages(1);
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 1);
    assert.equal(parsed.has_more, false);
    assert.equal(parsed.messages[0].user, "User 0");
  });

  // --- Thread reply URL ---

  it("uses thread_ts from URL as parent ts", async () => {
    const messages = makeThreadMessages(3);
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456?thread_ts=1111111111.000000",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.thread_ts, "1111111111.000000");

    // Verify fetchThreadContext was called with the thread_ts, not the message ts
    const callArgs = mockFetchThreadContext.mock.calls[0].arguments as unknown[];
    assert.equal(callArgs[2], "1111111111.000000");
  });

  // --- Empty result ---

  it("returns error when thread fetch returns empty", async () => {
    mockFetchThreadContext.mock.mockImplementation(async () => []);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Could not fetch thread"));
    assert.equal(result.isError, true);
  });

  // --- Max fetch cap ---

  it("returns error when requested range exceeds max fetch cap", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      page: 10,
      limit: 25,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("maximum fetch cap"));
    assert.equal(result.isError, true);
  });

  it("allows request exactly at max fetch cap boundary", async () => {
    mockFetchThreadContext.mock.mockImplementation(async () => makeThreadMessages(1));

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    // (0+1)*200 = 200 — exactly at cap, should succeed
    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      page: 0,
      limit: 200,
    }, { sessionId: "test" });

    assert.equal(result.isError, undefined);
  });

  it("rejects request just over max fetch cap boundary", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    // (1+1)*101 = 202 — just over cap
    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      page: 1,
      limit: 101,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("maximum fetch cap"));
    assert.equal(result.isError, true);
  });

  // --- Page beyond thread ---

  it("returns empty page when page exceeds thread length", async () => {
    const messages = makeThreadMessages(3);
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      page: 5,
      limit: 5,
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 0);
    assert.equal(parsed.has_more, false);
  });

  // --- Image/file registration ---

  it("registers images from paginated messages", async () => {
    const imageFile = { id: "F123", name: "screenshot.png", mimetype: "image/png", size: 1024, url_private: "https://example.com/img" };
    const messages = [
      { text: "Check this", userId: "U1", ts: "1.0", isBot: false, displayName: "Alice", imageFiles: [imageFile] },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const availableImages = new Map<string, SlackImageFile>();
    const ctx = makeCtx({ availableImages });
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].images[0].file_id, "F123");
    assert.ok(availableImages.has("F123"));
  });

  it("registers files from paginated messages", async () => {
    const file = { id: "F456", name: "doc.pdf", mimetype: "application/pdf", size: 2048, url_private: "https://example.com/file" };
    const messages = [
      { text: "See attached", userId: "U1", ts: "1.0", isBot: false, displayName: "Alice", files: [file] },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const availableFiles = new Map();
    const ctx = makeCtx({ availableFiles });
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].files[0].file_id, "F456");
    assert.ok(availableFiles.has("F456"));
  });

  it("only registers images from current page, not overfetch messages", async () => {
    const page0Image = { id: "F_PAGE0", name: "page0.png", mimetype: "image/png", size: 100, url_private: "https://example.com/0" };
    const page1Image = { id: "F_PAGE1", name: "page1.png", mimetype: "image/png", size: 100, url_private: "https://example.com/1" };
    const messages = [
      { text: "Msg 0", userId: "U0", ts: "0.0", isBot: false, displayName: "A", imageFiles: [page0Image] },
      { text: "Msg 1", userId: "U1", ts: "1.0", isBot: false, displayName: "B" },
      { text: "Msg 2", userId: "U2", ts: "2.0", isBot: false, displayName: "C", imageFiles: [page1Image] },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const availableImages = new Map<string, SlackImageFile>();
    const ctx = makeCtx({ availableImages });
    const toolDef = createFetchSlackMessageTool(ctx);

    // Request page 1 with limit 1 — only message at index 1 should be in the page
    await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      page: 1,
      limit: 1,
    }, { sessionId: "test" });

    // Page 0 image should NOT be registered, page 1 message has no image
    assert.equal(availableImages.has("F_PAGE0"), false);
    assert.equal(availableImages.has("F_PAGE1"), false);
  });

  // --- User display name fallback ---

  it("falls back to username when displayName is absent", async () => {
    const messages = [
      { text: "Hello", userId: "U1", ts: "1.0", isBot: false, username: "bob" },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].user, "bob");
  });

  it("falls back to userId when displayName and username are absent", async () => {
    const messages = [
      { text: "Hello", userId: "U1", ts: "1.0", isBot: false },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].user, "U1");
  });

  // --- Optional context maps ---

  it("works when availableImages and availableFiles are undefined", async () => {
    const imageFile = { id: "F1", name: "img.png", mimetype: "image/png", size: 100, url_private: "https://example.com/1" };
    const messages = [
      { text: "Msg", userId: "U1", ts: "1.0", isBot: false, displayName: "A", imageFiles: [imageFile] },
    ];
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx({ availableImages: undefined, availableFiles: undefined });
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    // Should not throw, and should return valid result
    assert.equal(result.isError, undefined);
    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 1);
  });

  // --- Output shape ---

  it("omits images and files keys when message has no attachments", async () => {
    const messages = makeThreadMessages(1);
    mockFetchThreadContext.mock.mockImplementation(async () => messages);

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    const result = await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal("images" in parsed.messages[0], false);
    assert.equal("files" in parsed.messages[0], false);
  });

  // --- fetchThreadContext call verification ---

  it("passes correct limit to fetchThreadContext for default params", async () => {
    mockFetchThreadContext.mock.mockImplementation(async () => makeThreadMessages(1));

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    }, { sessionId: "test" });

    const callArgs = mockFetchThreadContext.mock.calls[0].arguments as unknown[];
    const options = callArgs[4] as { limit: number };
    // (0+1)*5+1 = 6
    assert.equal(options.limit, 6);
  });

  it("passes correct limit to fetchThreadContext for custom page/limit", async () => {
    mockFetchThreadContext.mock.mockImplementation(async () => makeThreadMessages(1));

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx);

    await toolDef.handler({
      url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      page: 2,
      limit: 10,
    }, { sessionId: "test" });

    const callArgs = mockFetchThreadContext.mock.calls[0].arguments as unknown[];
    const options = callArgs[4] as { limit: number };
    // (2+1)*10+1 = 31
    assert.equal(options.limit, 31);
  });
});
