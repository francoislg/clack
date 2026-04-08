import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createFetchChannelMessagesTool,
  type FetchChannelMessagesDeps,
} from "./fetchChannelMessages.js";
import type { QueryToolContext } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<FetchChannelMessagesDeps> = {}): FetchChannelMessagesDeps {
  return {
    extractMessageText: mock.fn((msg) => {
      const m = msg as never as { text?: string };
      return m.text ?? "";
    }) as FetchChannelMessagesDeps["extractMessageText"],
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

interface MockSlackClient {
  conversations: {
    history: ReturnType<typeof mock.fn>;
    replies: ReturnType<typeof mock.fn>;
  };
}

function makeSlackClient(historyResult?: never, repliesResult?: never): MockSlackClient {
  return {
    conversations: {
      history: mock.fn(async () => historyResult ?? { messages: [], has_more: false }),
      replies: mock.fn(async () => repliesResult ?? { messages: [] }),
    },
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
      originalQuestion: "test",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: {
      repositories: [],
    } as never as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
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
    const ctx = makeCtx({ slackClient: undefined });
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

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Slack client is not available"));
    assert.equal(result.isError, true);
  });

  it("returns empty messages when channel has no messages", async () => {
    const client = makeSlackClient({ messages: [], has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.channel, "C123");
    assert.equal(parsed.message_count, 0);
    assert.deepEqual(parsed.messages, []);
  });

  it("returns empty messages when messages is undefined", async () => {
    const client = makeSlackClient({ messages: undefined } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 0);
  });

  it("fetches and formats messages correctly", async () => {
    const userInfoMap = new Map([
      ["U1", { userId: "U1", displayName: "Alice", username: "alice" }],
      ["U2", { userId: "U2", displayName: "Bob", username: "bob" }],
    ]);
    const deps = makeDeps({
      resolveUsers: mock.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
      extractMessageText: mock.fn(
        (msg) => (msg as never as { text: string }).text,
      ) as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [
      { ts: "1234567890.000002", text: "Second message", user: "U2" },
      { ts: "1234567890.000001", text: "First message", user: "U1" },
    ];
    const client = makeSlackClient({ messages, has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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
    const client = makeSlackClient({ messages: [], has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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
    const client = makeSlackClient({ messages: [], has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

  it("passes oldest and latest params to API", async () => {
    const client = makeSlackClient({ messages: [], has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

  it("marks bot messages correctly", async () => {
    const deps = makeDeps({
      extractMessageText: mock.fn(
        (msg) => (msg as never as { text: string }).text,
      ) as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [
      { ts: "1.0", text: "bot message", bot_id: "B1" },
      { ts: "2.0", text: "user message", user: "U1" },
    ];
    const client = makeSlackClient({ messages, has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    // Reversed order
    assert.equal(parsed.messages[0].is_bot, false);
    assert.equal(parsed.messages[1].is_bot, true);
  });

  it("skips messages without ts", async () => {
    const deps = makeDeps({
      extractMessageText: mock.fn(
        (msg) => (msg as never as { text?: string }).text ?? "",
      ) as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [
      { text: "no ts here", user: "U1" },
      { ts: "1.0", text: "valid", user: "U2" },
    ];
    const client = makeSlackClient({ messages, has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.message_count, 1);
    assert.equal(parsed.messages[0].ts, "1.0");
  });

  it("includes has_more flag from API response", async () => {
    const deps = makeDeps({
      extractMessageText: mock.fn(() => "msg") as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [{ ts: "1.0", text: "msg", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: true } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
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
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to fetch channel messages"));
    assert.ok(parsed.error.includes("channel_not_found"));
    assert.equal(result.isError, true);
  });

  it("includes reply_count on messages that have thread replies", async () => {
    const userInfoMap = new Map([["U1", { userId: "U1", displayName: "Alice" }]]);
    const deps = makeDeps({
      resolveUsers: mock.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
      extractMessageText: mock.fn(
        (msg) => (msg as never as { text: string }).text,
      ) as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [{ ts: "1.0", text: "threaded msg", user: "U1", reply_count: 3 }];
    const client = makeSlackClient({ messages, has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].reply_count, 3);
  });

  it("fetches thread replies when include_threads is true", async () => {
    const userInfoMap = new Map([
      ["U1", { userId: "U1", displayName: "Alice" }],
      ["U2", { userId: "U2", displayName: "Bob" }],
    ]);
    const deps = makeDeps({
      resolveUsers: mock.fn(async () => userInfoMap) as FetchChannelMessagesDeps["resolveUsers"],
      extractMessageText: mock.fn(
        (msg) => (msg as never as { text: string }).text,
      ) as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [{ ts: "1.0", text: "parent msg", user: "U1", reply_count: 1 }];
    const threadReplies = {
      messages: [
        { ts: "1.0", text: "parent msg", user: "U1" }, // parent repeated
        { ts: "1.1", text: "reply text", user: "U2" }, // actual reply
      ],
    };
    const client = makeSlackClient({ messages, has_more: false } as never, threadReplies as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
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
      extractMessageText: mock.fn(
        (msg) => (msg as never as { text: string }).text,
      ) as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [{ ts: "1.0", text: "parent msg", user: "U1", reply_count: 5 }];
    const client = makeSlackClient({ messages, has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].reply_count, 5);
    assert.equal(parsed.messages[0].thread_replies, undefined);
  });

  it("handles thread fetch error gracefully", async () => {
    const deps = makeDeps({
      resolveUsers: mock.fn(
        async () => new Map([["U1", { userId: "U1", displayName: "Alice" }]]),
      ) as FetchChannelMessagesDeps["resolveUsers"],
      extractMessageText: mock.fn(
        (msg) => (msg as never as { text: string }).text,
      ) as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [{ ts: "1.0", text: "parent msg", user: "U1", reply_count: 2 }];
    const client: MockSlackClient = {
      conversations: {
        history: mock.fn(async () => ({ messages, has_more: false })),
        replies: mock.fn(async () => {
          throw new Error("thread_not_found");
        }),
      },
    };
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].thread_error, "Failed to fetch thread replies");
  });

  it("falls back to [attachment] when extractMessageText returns empty", async () => {
    const deps = makeDeps({
      extractMessageText: mock.fn(() => "") as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [{ ts: "1.0", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].text, "[attachment]");
  });

  it("uses 'unknown' for user when no user or bot_id", async () => {
    const deps = makeDeps({
      extractMessageText: mock.fn(() => "text") as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [{ ts: "1.0", text: "text" }];
    const client = makeSlackClient({ messages, has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.messages[0].user, "unknown");
  });

  it("includes channel_name in result when resolved", async () => {
    const deps = makeDeps({
      getChannelInfo: mock.fn(async () => ({
        id: "C123",
        name: "backend-dev",
      })) as FetchChannelMessagesDeps["getChannelInfo"],
      extractMessageText: mock.fn(() => "text") as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [{ ts: "1.0", text: "text", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.channel_name, "backend-dev");
  });

  it("omits channel_name when resolution fails", async () => {
    const deps = makeDeps({
      getChannelInfo: mock.fn(async () => undefined) as FetchChannelMessagesDeps["getChannelInfo"],
      extractMessageText: mock.fn(() => "text") as FetchChannelMessagesDeps["extractMessageText"],
    });

    const messages = [{ ts: "1.0", text: "text", user: "U1" }];
    const client = makeSlackClient({ messages, has_more: false } as never);
    const ctx = makeCtx({ slackClient: client as never });
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

    const parsed = parseResult(result);
    assert.equal(parsed.channel_name, undefined);
  });
});
