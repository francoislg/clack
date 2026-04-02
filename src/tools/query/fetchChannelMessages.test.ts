import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockExtractMessageText = mock.fn<(msg: unknown) => string>();

mock.module("../../slack/messagesApi.js", {
  namedExports: {
    extractMessageText: mockExtractMessageText,
  },
});

const mockResolveUsers = mock.fn<(...args: unknown[]) => Promise<Map<string, unknown>>>();
const mockTransformUserMentions = mock.fn<(...args: unknown[]) => Promise<string>>();

mock.module("../../slack/userCache.js", {
  namedExports: {
    resolveUsers: mockResolveUsers,
    transformUserMentions: mockTransformUserMentions,
  },
});

mock.module("../../errors.js", {
  namedExports: {
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  },
});

// Import after mocks
const { createFetchChannelMessagesTool } = await import("./fetchChannelMessages.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";

function makeSlackClient(historyResult?: unknown, repliesResult?: unknown) {
  return {
    conversations: {
      history: mock.fn(async () => historyResult ?? { messages: [], has_more: false }),
      replies: mock.fn(async () => repliesResult ?? { messages: [] }),
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
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockExtractMessageText.mock.resetCalls();
  mockResolveUsers.mock.resetCalls();
  mockTransformUserMentions.mock.resetCalls();

  mockExtractMessageText.mock.mockImplementation((msg) => {
    const m = msg as { text?: string };
    return m.text ?? "";
  });
  mockResolveUsers.mock.mockImplementation(async () => new Map());
  mockTransformUserMentions.mock.mockImplementation(async (_client, text) => text as string);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchChannelMessages tool", () => {
  beforeEach(resetMocks);

  it("returns error when slackClient is not available", async () => {
    const ctx = makeCtx({ slackClient: undefined });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Slack client is not available"));
    assert.equal(result.isError, true);
  });

  it("returns empty messages when channel has no messages", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.channel, "C123");
    assert.equal(parsed.message_count, 0);
    assert.deepEqual(parsed.messages, []);
  });

  it("returns empty messages when messages is undefined", async () => {
    const client = makeSlackClient({ messages: undefined });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 0);
  });

  it("fetches and formats messages correctly", async () => {
    const userInfoMap = new Map([
      ["U1", { displayName: "Alice", username: "alice" }],
      ["U2", { displayName: "Bob", username: "bob" }],
    ]);
    mockResolveUsers.mock.mockImplementation(async () => userInfoMap);
    mockTransformUserMentions.mock.mockImplementation(async (_client, text) => text as string);
    mockExtractMessageText.mock.mockImplementation((msg) => (msg as { text: string }).text);

    const messages = [
      { ts: "1234567890.000002", text: "Second message", user: "U2" },
      { ts: "1234567890.000001", text: "First message", user: "U1" },
    ];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.channel, "C123");
    assert.equal(parsed.message_count, 2);
    // Messages should be reversed (oldest first)
    assert.equal(parsed.messages[0].user, "Alice");
    assert.equal(parsed.messages[0].text, "First message");
    assert.equal(parsed.messages[1].user, "Bob");
    assert.equal(parsed.messages[1].text, "Second message");
  });

  it("caps limit at 100", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const historyFn = (
      client as unknown as {
        conversations: { history: { mock: { calls: Array<{ arguments: unknown[] }> } } };
      }
    ).conversations.history;
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    await toolDef.handler(
      {
        channel_id: "C123",
        limit: 500,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    assert.equal(
      (historyFn as unknown as { mock: { calls: Array<{ arguments: Record<string, unknown>[] }> } })
        .mock.calls[0].arguments[0].limit,
      100,
    );
  });

  it("uses default limit of 20", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const historyFn = (
      client as unknown as {
        conversations: { history: { mock: { calls: Array<{ arguments: unknown[] }> } } };
      }
    ).conversations.history;
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    assert.equal(
      (historyFn as unknown as { mock: { calls: Array<{ arguments: Record<string, unknown>[] }> } })
        .mock.calls[0].arguments[0].limit,
      20,
    );
  });

  it("passes oldest and latest params to API", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const historyFn = (
      client as unknown as {
        conversations: { history: { mock: { calls: Array<{ arguments: unknown[] }> } } };
      }
    ).conversations.history;
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: "1234567890.000000",
        latest: "1234567899.000000",
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const callArgs = (
      historyFn as unknown as { mock: { calls: Array<{ arguments: Record<string, unknown>[] }> } }
    ).mock.calls[0].arguments[0];
    assert.equal(callArgs.oldest, "1234567890.000000");
    assert.equal(callArgs.latest, "1234567899.000000");
    assert.equal(callArgs.inclusive, true);
  });

  it("marks bot messages correctly", async () => {
    mockResolveUsers.mock.mockImplementation(async () => new Map());
    mockExtractMessageText.mock.mockImplementation((msg) => (msg as { text: string }).text);

    const messages = [
      { ts: "1.0", text: "bot message", bot_id: "B1" },
      { ts: "2.0", text: "user message", user: "U1" },
    ];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    // Reversed order
    assert.equal(parsed.messages[0].is_bot, false);
    assert.equal(parsed.messages[1].is_bot, true);
  });

  it("skips messages without ts", async () => {
    mockResolveUsers.mock.mockImplementation(async () => new Map());
    mockExtractMessageText.mock.mockImplementation((msg) => (msg as { text: string }).text ?? "");

    const messages = [
      { text: "no ts here", user: "U1" },
      { ts: "1.0", text: "valid", user: "U2" },
    ];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 1);
    assert.equal(parsed.messages[0].ts, "1.0");
  });

  it("includes has_more flag from API response", async () => {
    mockResolveUsers.mock.mockImplementation(async () => new Map());
    mockExtractMessageText.mock.mockImplementation(() => "msg");

    const messages = [{ ts: "1.0", text: "msg", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: true });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.has_more, true);
  });

  it("returns error when API call fails", async () => {
    const client = {
      conversations: {
        history: mock.fn(async () => {
          throw new Error("channel_not_found");
        }),
      },
    } as unknown as NonNullable<QueryToolContext["slackClient"]>;
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to fetch channel messages"));
    assert.ok(parsed.error.includes("channel_not_found"));
    assert.equal(result.isError, true);
  });

  it("includes reply_count on messages that have thread replies", async () => {
    const userInfoMap = new Map([["U1", { displayName: "Alice" }]]);
    mockResolveUsers.mock.mockImplementation(async () => userInfoMap);
    mockExtractMessageText.mock.mockImplementation((msg) => (msg as { text: string }).text);

    const messages = [{ ts: "1.0", text: "threaded msg", user: "U1", reply_count: 3 }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].reply_count, 3);
  });

  it("fetches thread replies when include_threads is true", async () => {
    const userInfoMap = new Map([
      ["U1", { displayName: "Alice" }],
      ["U2", { displayName: "Bob" }],
    ]);
    mockResolveUsers.mock.mockImplementation(async () => userInfoMap);
    mockExtractMessageText.mock.mockImplementation((msg) => (msg as { text: string }).text);

    const messages = [{ ts: "1.0", text: "parent msg", user: "U1", reply_count: 1 }];
    const threadReplies = {
      messages: [
        { ts: "1.0", text: "parent msg", user: "U1" }, // parent repeated
        { ts: "1.1", text: "reply text", user: "U2" }, // actual reply
      ],
    };
    const client = makeSlackClient({ messages, has_more: false }, threadReplies);
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].reply_count, 1);
    assert.ok(parsed.messages[0].thread_replies);
    assert.equal(parsed.messages[0].thread_replies.length, 1);
    assert.equal(parsed.messages[0].thread_replies[0].text, "reply text");
  });

  it("does not fetch thread replies when include_threads is false", async () => {
    mockResolveUsers.mock.mockImplementation(
      async () => new Map([["U1", { displayName: "Alice" }]]),
    );
    mockExtractMessageText.mock.mockImplementation((msg) => (msg as { text: string }).text);

    const messages = [{ ts: "1.0", text: "parent msg", user: "U1", reply_count: 5 }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: false,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].reply_count, 5);
    assert.equal(parsed.messages[0].thread_replies, undefined);
  });

  it("handles thread fetch error gracefully", async () => {
    mockResolveUsers.mock.mockImplementation(
      async () => new Map([["U1", { displayName: "Alice" }]]),
    );
    mockExtractMessageText.mock.mockImplementation((msg) => (msg as { text: string }).text);

    const messages = [{ ts: "1.0", text: "parent msg", user: "U1", reply_count: 2 }];
    const client = {
      conversations: {
        history: mock.fn(async () => ({ messages, has_more: false })),
        replies: mock.fn(async () => {
          throw new Error("thread_not_found");
        }),
      },
    } as unknown as NonNullable<QueryToolContext["slackClient"]>;
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].thread_error, "Failed to fetch thread replies");
  });

  it("falls back to [attachment] when extractMessageText returns empty", async () => {
    mockResolveUsers.mock.mockImplementation(async () => new Map());
    mockExtractMessageText.mock.mockImplementation(() => "");

    const messages = [{ ts: "1.0", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].text, "[attachment]");
  });

  it("uses 'unknown' for user when no user or bot_id", async () => {
    mockResolveUsers.mock.mockImplementation(async () => new Map());
    mockExtractMessageText.mock.mockImplementation(() => "text");

    const messages = [{ ts: "1.0", text: "text" }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx);

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].user, "unknown");
  });
});
