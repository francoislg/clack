import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createRemoveReactionTool } from "./removeReaction.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";

interface MockSlackClient {
  reactions: { remove: ReturnType<typeof mock.fn> };
}

function makeCtx(slackClient?: MockSlackClient): QueryToolContext {
  const ctx: QueryToolContext = Object.assign(Object.create(null), {
    mode: "query",
    userId: "U123",
    role: "member",
    session: {
      sessionId: "s1",
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
    slackClient,
  });
  return ctx;
}

function params(
  overrides: {
    emoji?: string;
    url?: string;
    channel_id?: string;
    message_ts?: string;
  } = {},
) {
  return {
    emoji: overrides.emoji ?? "thumbsup",
    url: overrides.url,
    channel_id: overrides.channel_id,
    message_ts: overrides.message_ts,
  };
}

describe("removeReaction tool", () => {
  it("removes reaction by channel_id and message_ts", async () => {
    const client: MockSlackClient = {
      reactions: { remove: mock.fn(async () => ({ ok: true })) },
    };
    const toolDef = createRemoveReactionTool(makeCtx(client));

    const result = await toolDef.handler(params({ channel_id: "C123", message_ts: "1.0" }), {
      sessionId: "test",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.emoji, "thumbsup");
    assert.equal(client.reactions.remove.mock.callCount(), 1);
  });

  it("removes reaction by Slack URL", async () => {
    const client: MockSlackClient = {
      reactions: { remove: mock.fn(async () => ({ ok: true })) },
    };
    const toolDef = createRemoveReactionTool(makeCtx(client));

    const result = await toolDef.handler(
      params({
        emoji: "eyes",
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
      }),
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.emoji, "eyes");
  });

  it("treats no_reaction as success", async () => {
    const client: MockSlackClient = {
      reactions: {
        remove: mock.fn(async () => {
          throw new Error("no_reaction");
        }),
      },
    };
    const toolDef = createRemoveReactionTool(makeCtx(client));

    const result = await toolDef.handler(params({ channel_id: "C123", message_ts: "1.0" }), {
      sessionId: "test",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.no_reaction, true);
  });

  it("returns error for invalid emoji name", async () => {
    const client: MockSlackClient = {
      reactions: {
        remove: mock.fn(async () => {
          throw new Error("invalid_name");
        }),
      },
    };
    const toolDef = createRemoveReactionTool(makeCtx(client));

    const result = await toolDef.handler(
      params({ emoji: "not_real", channel_id: "C123", message_ts: "1.0" }),
      { sessionId: "test" },
    );

    assert.equal(result.isError, true);
    assert.ok(parseToolResult(result).error.includes("Invalid emoji"));
  });

  it("returns error for message not found", async () => {
    const client: MockSlackClient = {
      reactions: {
        remove: mock.fn(async () => {
          throw new Error("message_not_found");
        }),
      },
    };
    const toolDef = createRemoveReactionTool(makeCtx(client));

    const result = await toolDef.handler(params({ channel_id: "C123", message_ts: "999.0" }), {
      sessionId: "test",
    });

    assert.equal(result.isError, true);
    assert.ok(parseToolResult(result).error.includes("Message not found"));
  });

  it("returns error for channel not found", async () => {
    const client: MockSlackClient = {
      reactions: {
        remove: mock.fn(async () => {
          throw new Error("channel_not_found");
        }),
      },
    };
    const toolDef = createRemoveReactionTool(makeCtx(client));

    const result = await toolDef.handler(params({ channel_id: "CINVALID", message_ts: "1.0" }), {
      sessionId: "test",
    });

    assert.equal(result.isError, true);
    assert.ok(parseToolResult(result).error.includes("Channel not found"));
  });

  it("returns error for invalid URL format", async () => {
    const client: MockSlackClient = {
      reactions: { remove: mock.fn(async () => ({ ok: true })) },
    };
    const toolDef = createRemoveReactionTool(makeCtx(client));

    const result = await toolDef.handler(params({ url: "https://not-a-slack-url.com/foo" }), {
      sessionId: "test",
    });

    assert.equal(result.isError, true);
    assert.ok(parseToolResult(result).error.includes("Invalid Slack message URL"));
  });

  it("returns error when neither URL nor channel_id+message_ts provided", async () => {
    const client: MockSlackClient = {
      reactions: { remove: mock.fn(async () => ({ ok: true })) },
    };
    const toolDef = createRemoveReactionTool(makeCtx(client));

    const result = await toolDef.handler(params(), { sessionId: "test" });

    assert.equal(result.isError, true);
    assert.ok(parseToolResult(result).error.includes("channel_id and message_ts"));
  });

  it("returns error when Slack client is not available", async () => {
    const toolDef = createRemoveReactionTool(makeCtx());

    const result = await toolDef.handler(params({ channel_id: "C123", message_ts: "1.0" }), {
      sessionId: "test",
    });

    assert.equal(result.isError, true);
    assert.ok(parseToolResult(result).error.includes("Slack client"));
  });
});
