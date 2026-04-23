import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createFetchChannelMessagesTool,
  type FetchChannelMessagesDeps,
} from "./fetchChannelMessages.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { ThreadMessage } from "../../sessions.js";

// ---------------------------------------------------------------------------
// Mock types & helpers
// ---------------------------------------------------------------------------

interface MockMessage {
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  reply_count?: number;
  blocks?: object[];
  attachments?: object[];
  files?: object[];
  reactions?: Array<{ name: string; users: string[] }>;
}

interface MockHistoryResult {
  messages?: MockMessage[];
  has_more?: boolean;
}

interface MockRepliesResult {
  messages?: MockMessage[];
}

interface MockSlackClient {
  conversations: {
    history: ReturnType<typeof mock.fn>;
    replies: ReturnType<typeof mock.fn>;
  };
}

/**
 * Default buildThreadMessage mock: converts raw Slack message shapes into ThreadMessage.
 * Mirrors the real function's filtering (skips messages without ts or without text/user).
 */
function mockBuildThreadMessage(msg: MockMessage, _botUserId: string): ThreadMessage | null {
  if (!msg.ts) return null;
  if (!msg.text && !msg.user && !msg.bot_id) return null;
  return {
    text: msg.text || "[attachment]",
    userId: (msg.user || msg.bot_id || "") as string,
    isBot: msg.bot_id !== undefined,
    ts: msg.ts,
    ...(msg.reactions?.length && {
      reactions: msg.reactions.map((r) => ({
        emoji: r.name,
        userIds: r.users,
      })),
    }),
  };
}

function makeDeps(overrides: Partial<FetchChannelMessagesDeps> = {}): FetchChannelMessagesDeps {
  return {
    buildThreadMessage: mock.fn(
      mockBuildThreadMessage,
    ) as FetchChannelMessagesDeps["buildThreadMessage"],
    resolveUsers: mock.fn(async () => new Map()) as FetchChannelMessagesDeps["resolveUsers"],
    transformUserMentions: mock.fn(
      async (_client, text) => text as string,
    ) as FetchChannelMessagesDeps["transformUserMentions"],
    getChannelInfo: mock.fn(async () => ({
      id: "C123",
      name: "general",
    })) as FetchChannelMessagesDeps["getChannelInfo"],
    ...overrides,
  };
}

function makeSlackClient(
  historyResult?: MockHistoryResult,
  repliesResult?: MockRepliesResult,
): MockSlackClient {
  return {
    conversations: {
      history: mock.fn(async () => historyResult ?? { messages: [], has_more: false }),
      replies: mock.fn(async () => repliesResult ?? { messages: [] }),
    },
  };
}

/**
 * Build a test QueryToolContext. The slackClient mock only implements the Slack API
 * methods exercised by fetchChannelMessages (conversations.history/replies).
 * Object.assign bypasses compile-time checking for the mock client field.
 */
function makeCtx(overrides?: {
  slackClient?: MockSlackClient;
  availableImages?: QueryToolContext["availableImages"];
  availableFiles?: QueryToolContext["availableFiles"];
}): QueryToolContext {
  // fetchChannelMessages only uses slackClient, availableImages, availableFiles from ctx.
  // Other fields satisfy the QueryToolContext interface but are unused by this tool.
  const ctx: QueryToolContext = Object.assign(Object.create(null), {
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
    config: { repositories: [] },
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    slackClient: overrides?.slackClient,
    availableImages: overrides?.availableImages,
    availableFiles: overrides?.availableFiles,
  });
  return ctx;
}

function historyCallArgs(client: MockSlackClient, callIndex = 0) {
  return client.conversations.history.mock.calls[callIndex].arguments[0] as {
    limit: number;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchChannelMessages tool", () => {
  it("returns error when slackClient is not available", async () => {
    const ctx = makeCtx();
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Slack client is not available"));
    assert.equal(result.isError, true);
  });

  it("returns empty messages when channel has no messages", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.channel, "C123");
    assert.equal(parsed.message_count, 0);
    assert.deepEqual(parsed.messages, []);
  });

  it("returns empty messages when messages is undefined", async () => {
    const client = makeSlackClient({ messages: undefined });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.message_count, 0);
  });

  it("fetches and formats messages correctly", async () => {
    const userInfoMap = new Map([
      ["U1", { userId: "U1", displayName: "Alice", username: "alice" }],
      ["U2", { userId: "U2", displayName: "Bob", username: "bob" }],
    ]);
    const deps = makeDeps({
      resolveUsers: mock.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
    });

    const messages: MockMessage[] = [
      { ts: "1234567890.000002", text: "Second message", user: "U2" },
      { ts: "1234567890.000001", text: "First message", user: "U1" },
    ];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, deps);

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

    const parsed = parseToolResult(result);
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
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    assert.equal(historyCallArgs(client).limit, 100);
  });

  it("uses default limit of 20", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    assert.equal(historyCallArgs(client).limit, 20);
  });

  it("passes numeric oldest and latest params to API unchanged", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const callArgs = historyCallArgs(client);
    assert.equal(callArgs.oldest, "1234567890.000000");
    assert.equal(callArgs.latest, "1234567899.000000");
    assert.equal(callArgs.inclusive, true);
  });

  it("accepts numeric epoch without fractional part", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

    await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: "1234567890",
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    assert.equal(historyCallArgs(client).oldest, "1234567890");
  });

  it("normalizes ISO 8601 oldest/latest to epoch before calling Slack", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

    await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: "2026-04-22T00:00:00-04:00",
        latest: "2026-04-22T23:59:59-04:00",
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const callArgs = historyCallArgs(client);
    const oldestEpoch = Date.parse("2026-04-22T00:00:00-04:00") / 1000;
    const latestEpoch = Date.parse("2026-04-22T23:59:59-04:00") / 1000;
    assert.equal(callArgs.oldest, oldestEpoch.toFixed(6));
    assert.equal(callArgs.latest, latestEpoch.toFixed(6));
  });

  it("normalizes date-only strings to epoch", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

    await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: "2026-04-22",
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const expected = (Date.parse("2026-04-22") / 1000).toFixed(6);
    assert.equal(historyCallArgs(client).oldest, expected);
  });

  it("returns tool error and does not call Slack when oldest is unparseable", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: "yesterday",
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("oldest"));
    assert.ok(parsed.error.includes("yesterday"));
    assert.equal(client.conversations.history.mock.callCount(), 0);
  });

  it("returns tool error and does not call Slack when latest is unparseable", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: undefined,
        latest: "not-a-date",
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("latest"));
    assert.ok(parsed.error.includes("not-a-date"));
    assert.equal(client.conversations.history.mock.callCount(), 0);
  });

  it("echoes normalized oldest/latest and ISO forms on empty results when provided", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: "2026-04-22T00:00:00Z",
        latest: "2026-04-22T23:59:59Z",
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    const oldestEpoch = (Date.parse("2026-04-22T00:00:00Z") / 1000).toFixed(6);
    const latestEpoch = (Date.parse("2026-04-22T23:59:59Z") / 1000).toFixed(6);
    assert.equal(parsed.oldest, oldestEpoch);
    assert.equal(parsed.latest, latestEpoch);
    assert.equal(parsed.oldest_iso, new Date(parseFloat(oldestEpoch) * 1000).toISOString());
    assert.equal(parsed.latest_iso, new Date(parseFloat(latestEpoch) * 1000).toISOString());
    assert.equal(parsed.has_more, false);
  });

  it("echoes normalized oldest/latest and ISO forms on non-empty results when provided", async () => {
    const messages: MockMessage[] = [{ ts: "1.0", text: "msg", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: true });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: "1234567890.000000",
        latest: "1234567899.000000",
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.oldest, "1234567890.000000");
    assert.equal(parsed.latest, "1234567899.000000");
    assert.equal(parsed.oldest_iso, new Date(1234567890 * 1000).toISOString());
    assert.equal(parsed.latest_iso, new Date(1234567899 * 1000).toISOString());
    assert.equal(parsed.has_more, true);
  });

  it("omits window fields when oldest/latest are not provided", async () => {
    const messages: MockMessage[] = [{ ts: "1.0", text: "msg", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.equal("oldest" in parsed, false);
    assert.equal("latest" in parsed, false);
    assert.equal("oldest_iso" in parsed, false);
    assert.equal("latest_iso" in parsed, false);
  });

  it("includes has_more on empty results even when no bounds are provided", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.has_more, false);
  });

  it("echoes only the provided bound when the other is omitted", async () => {
    const client = makeSlackClient({ messages: [], has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

    const result = await toolDef.handler(
      {
        channel_id: "C123",
        limit: undefined,
        oldest: "2026-04-22T00:00:00Z",
        latest: undefined,
        include_threads: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok("oldest" in parsed);
    assert.ok("oldest_iso" in parsed);
    assert.equal("latest" in parsed, false);
    assert.equal("latest_iso" in parsed, false);
  });

  it("marks bot messages correctly", async () => {
    const messages: MockMessage[] = [
      { ts: "1.0", text: "bot message", bot_id: "B1" },
      { ts: "2.0", text: "user message", user: "U1" },
    ];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    // Reversed order
    assert.equal(parsed.messages[0].is_bot, false);
    assert.equal(parsed.messages[1].is_bot, true);
  });

  it("skips messages without ts", async () => {
    const messages: MockMessage[] = [
      { text: "no ts here", user: "U1" },
      { ts: "1.0", text: "valid", user: "U2" },
    ];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.message_count, 1);
    assert.equal(parsed.messages[0].ts, "1.0");
  });

  it("includes has_more flag from API response", async () => {
    const messages: MockMessage[] = [{ ts: "1.0", text: "msg", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: true });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.has_more, true);
  });

  it("returns error when API call fails", async () => {
    const client: MockSlackClient = {
      conversations: {
        history: mock.fn(async () => {
          throw new Error("channel_not_found");
        }),
        replies: mock.fn(async () => ({ messages: [] })),
      },
    };
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to fetch channel messages"));
    assert.ok(parsed.error.includes("channel_not_found"));
    assert.equal(result.isError, true);
  });

  it("includes reply_count on messages that have thread replies", async () => {
    const userInfoMap = new Map([["U1", { userId: "U1", displayName: "Alice" }]]);
    const deps = makeDeps({
      resolveUsers: mock.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
    });

    const messages: MockMessage[] = [
      { ts: "1.0", text: "threaded msg", user: "U1", reply_count: 3 },
    ];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, deps);

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].reply_count, 3);
  });

  it("fetches thread replies when include_threads is true", async () => {
    const userInfoMap = new Map([
      ["U1", { userId: "U1", displayName: "Alice" }],
      ["U2", { userId: "U2", displayName: "Bob" }],
    ]);
    const deps = makeDeps({
      resolveUsers: mock.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
    });

    const messages: MockMessage[] = [{ ts: "1.0", text: "parent msg", user: "U1", reply_count: 1 }];
    const threadReplies: MockRepliesResult = {
      messages: [
        { ts: "1.0", text: "parent msg", user: "U1" },
        { ts: "1.1", text: "reply text", user: "U2" },
      ],
    };
    const client = makeSlackClient({ messages, has_more: false }, threadReplies);
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, deps);

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].reply_count, 1);
    assert.ok(parsed.messages[0].thread_replies);
    assert.equal(parsed.messages[0].thread_replies.length, 1);
    assert.equal(parsed.messages[0].thread_replies[0].text, "reply text");
  });

  it("does not fetch thread replies when include_threads is false", async () => {
    const deps = makeDeps({
      resolveUsers: mock.fn(
        async () => new Map([["U1", { userId: "U1", displayName: "Alice" }]]),
      ) as FetchChannelMessagesDeps["resolveUsers"],
    });

    const messages: MockMessage[] = [{ ts: "1.0", text: "parent msg", user: "U1", reply_count: 5 }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, deps);

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].reply_count, 5);
    assert.equal(parsed.messages[0].thread_replies, undefined);
  });

  it("handles thread fetch error gracefully", async () => {
    const deps = makeDeps({
      resolveUsers: mock.fn(
        async () => new Map([["U1", { userId: "U1", displayName: "Alice" }]]),
      ) as FetchChannelMessagesDeps["resolveUsers"],
    });

    const messages: MockMessage[] = [{ ts: "1.0", text: "parent msg", user: "U1", reply_count: 2 }];
    const client: MockSlackClient = {
      conversations: {
        history: mock.fn(async () => ({ messages, has_more: false })),
        replies: mock.fn(async () => {
          throw new Error("thread_not_found");
        }),
      },
    };
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, deps);

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].thread_error, "Failed to fetch thread replies");
  });

  it("falls back to [attachment] when message has no text", async () => {
    const messages: MockMessage[] = [{ ts: "1.0", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].text, "[attachment]");
  });

  it("skips messages that buildThreadMessage filters out", async () => {
    const buildFn = mock.fn((_msg: MockMessage, _botUserId: string) => null);
    const deps = makeDeps({
      buildThreadMessage: buildFn as FetchChannelMessagesDeps["buildThreadMessage"],
    });

    const messages: MockMessage[] = [{ ts: "1.0" }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, deps);

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.message_count, 0);
  });

  it("includes channel_name in result when resolved", async () => {
    const deps = makeDeps({
      getChannelInfo: mock.fn(async () => ({
        id: "C123",
        name: "backend-dev",
      })) as FetchChannelMessagesDeps["getChannelInfo"],
    });

    const messages: MockMessage[] = [{ ts: "1.0", text: "text", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, deps);

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.channel_name, "backend-dev");
  });

  it("omits channel_name when resolution fails", async () => {
    const deps = makeDeps({
      getChannelInfo: mock.fn(async () => undefined) as FetchChannelMessagesDeps["getChannelInfo"],
    });

    const messages: MockMessage[] = [{ ts: "1.0", text: "text", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, deps);

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.channel_name, undefined);
  });

  it("includes reactions in output when message has reactions", async () => {
    const userInfoMap = new Map([
      ["U1", { userId: "U1", displayName: "Alice" }],
      ["U2", { userId: "U2", displayName: "Bob" }],
      ["U3", { userId: "U3", displayName: "Charlie" }],
    ]);
    const deps = makeDeps({
      resolveUsers: mock.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
    });

    const messages: MockMessage[] = [
      {
        ts: "1.0",
        text: "Deploy?",
        user: "U1",
        reactions: [{ name: "thumbsup", users: ["U2", "U3"] }],
      },
    ];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, deps);

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

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].reactions.length, 1);
    assert.equal(parsed.messages[0].reactions[0].emoji, "thumbsup");
    assert.deepEqual(parsed.messages[0].reactions[0].users, ["Bob (U2)", "Charlie (U3)"]);
  });

  it("omits reactions key when message has no reactions", async () => {
    const messages: MockMessage[] = [{ ts: "1.0", text: "no reactions", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: false });
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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

    const parsed = parseToolResult(result);
    assert.equal("reactions" in parsed.messages[0], false);
  });
});
