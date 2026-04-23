import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createFetchSlackMessageTool, type FetchSlackMessageDeps } from "./fetchSlackMessage.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { SlackImageFile } from "../../slack/slackFileBase.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<FetchSlackMessageDeps> = {}): FetchSlackMessageDeps {
  return {
    fetchThreadContext: mock.fn(async () => []) as FetchSlackMessageDeps["fetchThreadContext"],
    getChannelInfo: mock.fn(async () => ({
      id: "C0123ABC",
      name: "general",
    })) as FetchSlackMessageDeps["getChannelInfo"],
    ...overrides,
  };
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
      trigger: { type: "mentions", userId: "U123", messageTs: "1.0", messageText: "test" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: {
      repositories: [],
    } as never as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    slackClient: {} as never as NonNullable<QueryToolContext["slackClient"]>,
    availableImages: new Map(),
    availableFiles: new Map(),
    ...overrides,
  };
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchSlackMessage tool", () => {
  // --- URL parsing ---

  it("returns error for invalid URL format", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, makeDeps());

    const result = await toolDef.handler(
      { url: "not-a-url", page: undefined, limit: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid Slack message URL"));
    assert.equal(result.isError, true);
  });

  it("returns error for non-Slack URL", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, makeDeps());

    const result = await toolDef.handler(
      { url: "https://example.com/page", page: undefined, limit: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid Slack message URL"));
    assert.equal(result.isError, true);
  });

  it("returns error for slack.com URL without workspace subdomain", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, makeDeps());

    const result = await toolDef.handler(
      {
        url: "https://slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid Slack message URL"));
    assert.equal(result.isError, true);
  });

  // --- slackClient absent ---

  it("returns error when slackClient is not available", async () => {
    const ctx = makeCtx({ slackClient: undefined });
    const toolDef = createFetchSlackMessageTool(ctx, makeDeps());

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Slack client is not available"));
    assert.equal(result.isError, true);
  });

  // --- Default pagination (5 messages) ---

  it("fetches thread with default pagination of 5 messages", async () => {
    const messages = makeThreadMessages(8);
    const deps = makeDeps({
      fetchThreadContext: mock.fn(async () =>
        messages.slice(0, 6),
      ) as FetchSlackMessageDeps["fetchThreadContext"], // 6 = (0+1)*5+1
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
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
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.message_count, 3);
    assert.equal(parsed.has_more, false);
  });

  // --- Custom page/limit ---

  it("fetches custom page and limit", async () => {
    const messages = makeThreadMessages(25);
    const deps = makeDeps({
      fetchThreadContext: mock.fn(async () =>
        messages.slice(0, 21),
      ) as FetchSlackMessageDeps["fetchThreadContext"], // (1+1)*10+1
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: 1,
        limit: 10,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 10);
    assert.equal(parsed.message_count, 10);
    assert.equal(parsed.messages[0].user, "User 10");
    assert.equal(parsed.has_more, true);
  });

  // --- has_more detection ---

  it("detects has_more when thread is longer than page", async () => {
    const messages = makeThreadMessages(6); // exactly limit+1
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.message_count, 5);
    assert.equal(parsed.has_more, true);
  });

  it("returns has_more false when exactly at limit", async () => {
    const messages = makeThreadMessages(5);
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.message_count, 5);
    assert.equal(parsed.has_more, false);
  });

  // --- Standalone message (no thread) ---

  it("returns single message for standalone message URL", async () => {
    const messages = makeThreadMessages(1);
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.message_count, 1);
    assert.equal(parsed.has_more, false);
    assert.equal(parsed.messages[0].user, "User 0");
  });

  // --- Thread reply URL ---

  it("uses thread_ts from URL as parent ts", async () => {
    const messages = makeThreadMessages(3);
    const fetchThreadContextFn = mock.fn<FetchSlackMessageDeps["fetchThreadContext"]>(
      async () => messages,
    );
    const deps = makeDeps({
      fetchThreadContext: fetchThreadContextFn,
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456?thread_ts=1111111111.000000",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.thread_ts, "1111111111.000000");

    // Verify fetchThreadContext was called with the thread_ts, not the message ts
    const callArgs = fetchThreadContextFn.mock.calls[0].arguments;
    assert.equal(callArgs[2], "1111111111.000000");
  });

  // --- Empty result ---

  it("returns error when thread fetch returns empty", async () => {
    const deps = makeDeps({
      fetchThreadContext: mock.fn(async () => []) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Could not fetch thread"));
    assert.equal(result.isError, true);
  });

  // --- Max fetch cap ---

  it("returns error when requested range exceeds max fetch cap", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, makeDeps());

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: 10,
        limit: 25,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("maximum fetch cap"));
    assert.equal(result.isError, true);
  });

  it("allows request exactly at max fetch cap boundary", async () => {
    const deps = makeDeps({
      fetchThreadContext: mock.fn(async () =>
        makeThreadMessages(1),
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    // (0+1)*200 = 200 — exactly at cap, should succeed
    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: 0,
        limit: 200,
      },
      { sessionId: "test" },
    );

    assert.equal(result.isError, undefined);
  });

  it("rejects request just over max fetch cap boundary", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, makeDeps());

    // (1+1)*101 = 202 — just over cap
    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: 1,
        limit: 101,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("maximum fetch cap"));
    assert.equal(result.isError, true);
  });

  // --- Page beyond thread ---

  it("returns empty page when page exceeds thread length", async () => {
    const messages = makeThreadMessages(3);
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: 5,
        limit: 5,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.message_count, 0);
    assert.equal(parsed.has_more, false);
  });

  // --- Image/file registration ---

  it("registers images from paginated messages", async () => {
    const imageFile = {
      id: "F123",
      name: "screenshot.png",
      mimetype: "image/png",
      size: 1024,
      url_private: "https://example.com/img",
    };
    const messages = [
      {
        text: "Check this",
        userId: "U1",
        ts: "1.0",
        isBot: false,
        displayName: "Alice",
        imageFiles: [imageFile],
      },
    ];
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const availableImages = new Map<string, SlackImageFile>();
    const ctx = makeCtx({ availableImages });
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].images[0].file_id, "F123");
    assert.ok(availableImages.has("F123"));
  });

  it("registers files from paginated messages", async () => {
    const file = {
      id: "F456",
      name: "doc.pdf",
      mimetype: "application/pdf",
      size: 2048,
      url_private: "https://example.com/file",
    };
    const messages = [
      {
        text: "See attached",
        userId: "U1",
        ts: "1.0",
        isBot: false,
        displayName: "Alice",
        files: [file],
      },
    ];
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const availableFiles = new Map();
    const ctx = makeCtx({ availableFiles });
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].files[0].file_id, "F456");
    assert.ok(availableFiles.has("F456"));
  });

  it("only registers images from current page, not overfetch messages", async () => {
    const page0Image = {
      id: "F_PAGE0",
      name: "page0.png",
      mimetype: "image/png",
      size: 100,
      url_private: "https://example.com/0",
    };
    const page1Image = {
      id: "F_PAGE1",
      name: "page1.png",
      mimetype: "image/png",
      size: 100,
      url_private: "https://example.com/1",
    };
    const messages = [
      {
        text: "Msg 0",
        userId: "U0",
        ts: "0.0",
        isBot: false,
        displayName: "A",
        imageFiles: [page0Image],
      },
      {
        text: "Msg 1",
        userId: "U1",
        ts: "1.0",
        isBot: false,
        displayName: "B",
      },
      {
        text: "Msg 2",
        userId: "U2",
        ts: "2.0",
        isBot: false,
        displayName: "C",
        imageFiles: [page1Image],
      },
    ];
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const availableImages = new Map<string, SlackImageFile>();
    const ctx = makeCtx({ availableImages });
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    // Request page 1 with limit 1 — only message at index 1 should be in the page
    await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: 1,
        limit: 1,
      },
      { sessionId: "test" },
    );

    // Page 0 image should NOT be registered, page 1 message has no image
    assert.equal(availableImages.has("F_PAGE0"), false);
    assert.equal(availableImages.has("F_PAGE1"), false);
  });

  // --- User display name fallback ---

  it("falls back to username when displayName is absent", async () => {
    const messages = [{ text: "Hello", userId: "U1", ts: "1.0", isBot: false, username: "bob" }];
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].user, "bob");
  });

  it("falls back to userId when displayName and username are absent", async () => {
    const messages = [{ text: "Hello", userId: "U1", ts: "1.0", isBot: false }];
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].user, "U1");
  });

  // --- Optional context maps ---

  it("works when availableImages and availableFiles are undefined", async () => {
    const imageFile = {
      id: "F1",
      name: "img.png",
      mimetype: "image/png",
      size: 100,
      url_private: "https://example.com/1",
    };
    const messages = [
      {
        text: "Msg",
        userId: "U1",
        ts: "1.0",
        isBot: false,
        displayName: "A",
        imageFiles: [imageFile],
      },
    ];
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx({
      availableImages: undefined,
      availableFiles: undefined,
    });
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    // Should not throw, and should return valid result
    assert.equal(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.equal(parsed.message_count, 1);
  });

  // --- Output shape ---

  it("omits images and files keys when message has no attachments", async () => {
    const messages = makeThreadMessages(1);
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal("images" in parsed.messages[0], false);
    assert.equal("files" in parsed.messages[0], false);
  });

  it("includes reactions in output when message has reactions", async () => {
    const messages = [
      {
        text: "Deploy?",
        userId: "U1",
        ts: "1.0",
        isBot: false,
        displayName: "Alice",
        reactions: [
          {
            emoji: "thumbsup",
            userIds: ["U2", "U3"],
            usernames: ["Bob", "Charlie"],
          },
          { emoji: "eyes", userIds: ["U4"], usernames: ["Dave"] },
        ],
      },
    ];
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);
    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].reactions.length, 2);
    assert.equal(parsed.messages[0].reactions[0].emoji, "thumbsup");
    assert.deepEqual(parsed.messages[0].reactions[0].users, ["Bob (U2)", "Charlie (U3)"]);
    assert.equal(parsed.messages[0].reactions[1].emoji, "eyes");
    assert.deepEqual(parsed.messages[0].reactions[1].users, ["Dave (U4)"]);
  });

  it("omits reactions key when message has no reactions", async () => {
    const messages = makeThreadMessages(1);
    const deps = makeDeps({
      fetchThreadContext: mock.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);
    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal("reactions" in parsed.messages[0], false);
  });

  // --- fetchThreadContext call verification ---

  it("passes correct limit to fetchThreadContext for default params", async () => {
    const fetchThreadContextFn = mock.fn<FetchSlackMessageDeps["fetchThreadContext"]>(async () =>
      makeThreadMessages(1),
    );
    const deps = makeDeps({ fetchThreadContext: fetchThreadContextFn });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const callArgs = fetchThreadContextFn.mock.calls[0].arguments;
    const options = callArgs[4];
    // (0+1)*5+1 = 6
    assert.equal(options?.limit, 6);
  });

  it("passes correct limit to fetchThreadContext for custom page/limit", async () => {
    const fetchThreadContextFn = mock.fn<FetchSlackMessageDeps["fetchThreadContext"]>(async () =>
      makeThreadMessages(1),
    );
    const deps = makeDeps({ fetchThreadContext: fetchThreadContextFn });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: 2,
        limit: 10,
      },
      { sessionId: "test" },
    );

    const callArgs = fetchThreadContextFn.mock.calls[0].arguments;
    const options = callArgs[4];
    // (2+1)*10+1 = 31
    assert.equal(options?.limit, 31);
  });

  it("includes channel_name in result when resolved", async () => {
    const deps = makeDeps({
      getChannelInfo: mock.fn(async () => ({
        id: "C0123ABC",
        name: "backend-dev",
      })) as FetchSlackMessageDeps["getChannelInfo"],
      fetchThreadContext: mock.fn(async () =>
        makeThreadMessages(1),
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.channel_name, "backend-dev");
  });

  it("omits channel_name when resolution fails", async () => {
    const deps = makeDeps({
      getChannelInfo: mock.fn(async () => undefined) as FetchSlackMessageDeps["getChannelInfo"],
      fetchThreadContext: mock.fn(async () =>
        makeThreadMessages(1),
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.channel_name, undefined);
  });
});
