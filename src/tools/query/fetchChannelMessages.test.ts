import { describe, it, vi } from "vitest";
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
  latest_reply?: string;
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
    history: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
    replies: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
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
    buildThreadMessage: vi.fn(
      mockBuildThreadMessage,
    ) as FetchChannelMessagesDeps["buildThreadMessage"],
    resolveUsers: vi.fn(async () => new Map()) as FetchChannelMessagesDeps["resolveUsers"],
    transformUserMentions: vi.fn(
      async (_client, text) => text as string,
    ) as FetchChannelMessagesDeps["transformUserMentions"],
    getChannelInfo: vi.fn(async () => ({
      id: "C123",
      name: "general",
    })) as FetchChannelMessagesDeps["getChannelInfo"],
    slackLink: async (_client, channelId, ts) =>
      ` https://test.slack.com/archives/${channelId}/p${(ts ?? "").replace(".", "")}`,
    ...overrides,
  };
}

function makeSlackClient(
  historyResult?: MockHistoryResult,
  repliesResult?: MockRepliesResult,
): MockSlackClient {
  return {
    conversations: {
      history: vi.fn(async () => historyResult ?? { messages: [], has_more: false }),
      replies: vi.fn(async () => repliesResult ?? { messages: [] }),
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
    cronUserSchedules: false,
    slackClient: overrides?.slackClient,
    availableImages: overrides?.availableImages,
    availableFiles: overrides?.availableFiles,
  });
  return ctx;
}

function historyCallArgs(client: MockSlackClient, callIndex = 0) {
  return client.conversations.history.mock.calls[callIndex][0] as {
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
      resolveUsers: vi.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
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
    // Each message carries a human-readable UTC form of its ts.
    assert.equal(parsed.messages[0].at_iso, new Date(1234567890.000001 * 1000).toISOString());
  });

  it("includes a fetched_at reference clock with epoch and ISO forms", async () => {
    const messages: MockMessage[] = [{ ts: "1.0", text: "hi", user: "U1" }];
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
    assert.ok(/^\d+\.\d{6}$/.test(parsed.fetched_at.epoch));
    assert.ok(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(parsed.fetched_at.iso));
    // epoch and iso describe the same instant.
    assert.equal(
      new Date(parseFloat(parsed.fetched_at.epoch) * 1000).toISOString(),
      parsed.fetched_at.iso,
    );
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
    assert.equal(client.conversations.history.mock.calls.length, 0);
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
    assert.equal(client.conversations.history.mock.calls.length, 0);
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
        history: vi.fn(async () => {
          throw new Error("channel_not_found");
        }),
        replies: vi.fn(async () => ({ messages: [] })),
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
      resolveUsers: vi.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
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

  it("returns only the single newest reply as last_reply when include_threads is true", async () => {
    const messages: MockMessage[] = [
      { ts: "1.0", text: "parent msg", user: "U1", reply_count: 4, latest_reply: "1.4" },
    ];
    // The tool pins latest=latest_reply and limit=1, so the mock returns just the newest reply.
    const threadReplies: MockRepliesResult = {
      messages: [{ ts: "1.4", text: "newest reply", user: "U2" }],
    };
    const client = makeSlackClient({ messages, has_more: false }, threadReplies);
    const ctx = makeCtx({ slackClient: client });
    const toolDef = createFetchChannelMessagesTool(ctx, makeDeps());

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
    assert.equal(parsed.messages[0].reply_count, 4);
    assert.equal(parsed.messages[0].last_reply.text, "newest reply");
    assert.equal(parsed.messages[0].last_reply.ts, "1.4");
    assert.equal(parsed.messages[0].last_reply.at_iso, new Date(1.4 * 1000).toISOString());
    assert.equal(parsed.messages[0].last_reply.is_bot, false);
    // url is the dig handle for reading the full thread.
    assert.equal(parsed.messages[0].url, "https://test.slack.com/archives/C123/p10");
  });

  it("does not include last_reply when include_threads is false, but keeps reply_count and url", async () => {
    const messages: MockMessage[] = [
      { ts: "1.0", text: "parent msg", user: "U1", reply_count: 5, latest_reply: "1.5" },
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
        include_threads: false,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].reply_count, 5);
    assert.equal("last_reply" in parsed.messages[0], false);
    assert.equal(parsed.messages[0].url, "https://test.slack.com/archives/C123/p10");
  });

  it("reports thread_error when the latest-reply fetch fails", async () => {
    const messages: MockMessage[] = [
      { ts: "1.0", text: "parent msg", user: "U1", reply_count: 2, latest_reply: "1.2" },
    ];
    const client: MockSlackClient = {
      conversations: {
        history: vi.fn(async () => ({ messages, has_more: false })),
        replies: vi.fn(async () => {
          throw new Error("thread_not_found");
        }),
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
        include_threads: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.messages[0].thread_error, "Failed to fetch latest reply");
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
    const buildFn = vi.fn((_msg: MockMessage, _botUserId: string) => null);
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
      getChannelInfo: vi.fn(async () => ({
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
      getChannelInfo: vi.fn(async () => undefined) as FetchChannelMessagesDeps["getChannelInfo"],
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

  it("includes channel_purpose in result when the channel has a purpose", async () => {
    const getChannelInfo: FetchChannelMessagesDeps["getChannelInfo"] = vi.fn(async () => ({
      id: "C123",
      name: "memes",
      purpose: "Post your best memes",
    }));
    const deps = makeDeps({ getChannelInfo });

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
    assert.equal(parsed.channel_purpose, "Post your best memes");
  });

  it("omits channel_purpose when the channel has no purpose", async () => {
    const getChannelInfo: FetchChannelMessagesDeps["getChannelInfo"] = vi.fn(async () => ({
      id: "C123",
      name: "backend-dev",
    }));
    const deps = makeDeps({ getChannelInfo });

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
    assert.equal(parsed.channel_purpose, undefined);
  });

  it("includes channel_purpose on the empty-messages result path", async () => {
    const getChannelInfo: FetchChannelMessagesDeps["getChannelInfo"] = vi.fn(async () => ({
      id: "C123",
      name: "memes",
      purpose: "Post your best memes",
    }));
    const deps = makeDeps({ getChannelInfo });

    const client = makeSlackClient({ messages: [], has_more: false });
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
    assert.equal(parsed.channel_purpose, "Post your best memes");
  });

  it("omits channel_purpose when resolution fails", async () => {
    const getChannelInfo: FetchChannelMessagesDeps["getChannelInfo"] = vi.fn(async () => undefined);
    const deps = makeDeps({ getChannelInfo });

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
    assert.equal(parsed.channel_purpose, undefined);
  });

  it("includes reactions in output when message has reactions", async () => {
    const userInfoMap = new Map([
      ["U1", { userId: "U1", displayName: "Alice" }],
      ["U2", { userId: "U2", displayName: "Bob" }],
      ["U3", { userId: "U3", displayName: "Charlie" }],
    ]);
    const deps = makeDeps({
      resolveUsers: vi.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
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

  it("truncates long message text", async () => {
    const longText = "x".repeat(700);
    const messages: MockMessage[] = [{ ts: "1.0", text: longText, user: "U1" }];
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
    assert.ok(parsed.messages[0].text.startsWith("x".repeat(600)));
    // Body was cut to 600 chars (no 601-run survives) and points the model at the dig tool.
    assert.ok(!parsed.messages[0].text.includes("x".repeat(601)));
    assert.ok(parsed.messages[0].text.includes("fetch_slack_message"));
  });

  it("omits raw blocks and attachments from output", async () => {
    const buildWithBlocks: FetchChannelMessagesDeps["buildThreadMessage"] = (msg) => {
      if (!msg.ts) return null;
      return {
        text: msg.text ?? "",
        userId: msg.user ?? "",
        isBot: false,
        ts: msg.ts,
        blocks: [{ type: "section" }],
        attachments: [{ text: "legacy" }],
      };
    };
    const deps = makeDeps({ buildThreadMessage: buildWithBlocks });

    const messages: MockMessage[] = [{ ts: "1.0", text: "hi", user: "U1" }];
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
    assert.equal("blocks" in parsed.messages[0], false);
    assert.equal("attachments" in parsed.messages[0], false);
    assert.equal(parsed.messages[0].text, "hi");
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
