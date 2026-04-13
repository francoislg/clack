import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { extractMessageText } from "./messageBuilder.js";
import {
  fetchThreadContext,
  fetchMessage,
  hasThreadReplies,
  sendDirectMessage,
  sendErrorReport,
} from "./messagesApi.js";
import type { ConversationMessage } from "../claude/index.js";

// ---------------------------------------------------------------------------
// extractMessageText — pure function tests
// ---------------------------------------------------------------------------

describe("extractMessageText", () => {
  it("returns text when present", () => {
    assert.equal(extractMessageText({ text: "hello" }), "hello");
  });

  it("returns empty string when no text and no attachments", () => {
    assert.equal(extractMessageText({}), "");
  });

  it("returns empty string for explicit undefined text", () => {
    assert.equal(extractMessageText({ text: undefined }), "");
  });

  it("returns empty string for empty text string", () => {
    assert.equal(extractMessageText({ text: "" }), "");
  });

  it("returns attachment text when no main text", () => {
    assert.equal(
      extractMessageText({
        attachments: [{ text: "attachment content" }],
      }),
      "attachment content",
    );
  });

  it("returns attachment fallback when no text on attachment", () => {
    assert.equal(
      extractMessageText({
        attachments: [{ fallback: "fallback content" }],
      }),
      "fallback content",
    );
  });

  it("prefers attachment text over fallback", () => {
    assert.equal(
      extractMessageText({
        attachments: [{ text: "primary", fallback: "secondary" }],
      }),
      "primary",
    );
  });

  it("joins multiple attachment texts with newline", () => {
    assert.equal(
      extractMessageText({
        attachments: [{ text: "first" }, { text: "second" }],
      }),
      "first\nsecond",
    );
  });

  it("filters out empty attachments", () => {
    assert.equal(
      extractMessageText({
        attachments: [{}, { text: "valid" }, {}],
      }),
      "valid",
    );
  });

  it("prefers msg.text over attachments", () => {
    assert.equal(
      extractMessageText({
        text: "main text",
        attachments: [{ text: "attachment text" }],
      }),
      "main text",
    );
  });

  it("returns empty string for empty attachments array", () => {
    assert.equal(extractMessageText({ attachments: [] }), "");
  });

  // --- Blocks extraction ---

  it("extracts text from section blocks when no msg.text", () => {
    assert.equal(
      extractMessageText({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "section content" },
          },
        ],
      }),
      "section content",
    );
  });

  it("extracts text from section fields", () => {
    assert.equal(
      extractMessageText({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "title" },
            fields: [
              { type: "mrkdwn", text: "*Key:*" },
              { type: "plain_text", text: "Value" },
            ],
          },
        ],
      }),
      "title\n*Key:*\nValue",
    );
  });

  it("extracts text from header blocks", () => {
    assert.equal(
      extractMessageText({
        blocks: [{ type: "header", text: { type: "plain_text", text: "Header!" } }],
      }),
      "Header!",
    );
  });

  it("extracts text from rich_text blocks", () => {
    assert.equal(
      extractMessageText({
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: "Hello " },
                  { type: "text", text: "world" },
                ],
              },
            ],
          },
        ],
      }),
      "Hello world",
    );
  });

  it("extracts mentions from rich_text blocks", () => {
    assert.equal(
      extractMessageText({
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: "Hey " },
                  { type: "user", user_id: "U123" },
                  { type: "text", text: " in " },
                  { type: "channel", channel_id: "C456" },
                ],
              },
            ],
          },
        ],
      }),
      "Hey <@U123> in <#C456>",
    );
  });

  it("extracts text from rich_text_list", () => {
    assert.equal(
      extractMessageText({
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_list",
                style: "bullet",
                elements: [
                  {
                    type: "rich_text_section",
                    elements: [{ type: "text", text: "item one" }],
                  },
                  {
                    type: "rich_text_section",
                    elements: [{ type: "text", text: "item two" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
      "• item one\n• item two",
    );
  });

  it("extracts text from rich_text_preformatted", () => {
    assert.equal(
      extractMessageText({
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_preformatted",
                elements: [{ type: "text", text: "code here" }],
              },
            ],
          },
        ],
      }),
      "```\ncode here\n```",
    );
  });

  it("extracts text from context blocks", () => {
    assert.equal(
      extractMessageText({
        blocks: [
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: "context info" },
              { type: "plain_text", text: "more context" },
            ],
          },
        ],
      }),
      "context info more context",
    );
  });

  it("joins text from multiple blocks", () => {
    assert.equal(
      extractMessageText({
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Title" } },
          { type: "section", text: { type: "mrkdwn", text: "Body" } },
        ],
      }),
      "Title\nBody",
    );
  });

  it("skips divider blocks", () => {
    assert.equal(
      extractMessageText({
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "before" } },
          { type: "divider" },
          { type: "section", text: { type: "mrkdwn", text: "after" } },
        ],
      }),
      "before\nafter",
    );
  });

  it("prefers blocks over msg.text when blocks have content", () => {
    assert.equal(
      extractMessageText({
        text: "plain text",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "block text" } }],
      }),
      "block text",
    );
  });

  it("falls back to msg.text when blocks yield no text", () => {
    assert.equal(
      extractMessageText({
        text: "fallback",
        blocks: [{ type: "divider" }],
      }),
      "fallback",
    );
  });

  it("falls back to attachments when blocks have no text", () => {
    assert.equal(
      extractMessageText({
        blocks: [{ type: "divider" }],
        attachments: [{ text: "attachment text" }],
      }),
      "attachment text",
    );
  });
});

// ---------------------------------------------------------------------------
// Mock Slack client helper
// ---------------------------------------------------------------------------

interface MockConversationsConfig {
  replies?: Record<
    string,
    Array<{
      text?: string;
      user?: string;
      bot_id?: string;
      ts?: string;
      attachments?: { text?: string; fallback?: string }[];
    }>
  >;
  history?: Record<
    string,
    Array<{
      text?: string;
      user?: string;
      bot_id?: string;
      ts?: string;
      attachments?: { text?: string; fallback?: string }[];
    }>
  >;
  openChannel?: string;
  throwOnReplies?: boolean;
  throwOnHistory?: boolean;
  throwOnOpen?: boolean;
}

function makeClient(config: MockConversationsConfig = {}): App["client"] {
  const postMessageFn = mock.fn(async () => ({ ok: true, ts: "msg-ts" }));
  const filesUploadV2Fn = mock.fn(async () => ({ ok: true }));
  const repliesFn = mock.fn(async ({ channel, ts }: { channel: string; ts: string }) => {
    if (config.throwOnReplies) throw new Error("replies_error");
    const key = `${channel}:${ts}`;
    return { ok: true, messages: config.replies?.[key] ?? [] };
  });

  return {
    conversations: {
      replies: repliesFn,
      history: async ({ channel, latest }: { channel: string; latest: string }) => {
        if (config.throwOnHistory) throw new Error("history_error");
        const key = `${channel}:${latest}`;
        return { ok: true, messages: config.history?.[key] ?? [] };
      },
      open: async () => {
        if (config.throwOnOpen) throw new Error("open_error");
        return {
          ok: true,
          channel: config.openChannel ? { id: config.openChannel } : undefined,
        };
      },
    },
    chat: {
      postMessage: postMessageFn,
    },
    filesUploadV2: filesUploadV2Fn,
    users: {
      info: async () => ({ ok: false }),
    },
    bots: {
      info: async () => ({ ok: false }),
    },
  } as unknown as App["client"];
}

// ---------------------------------------------------------------------------
// fetchThreadContext
// ---------------------------------------------------------------------------

describe("fetchThreadContext", () => {
  it("returns empty array when no messages", async () => {
    const client = makeClient({ replies: { "C1:ts1": [] } });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.deepEqual(result, []);
  });

  it("maps messages to ThreadMessage objects", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [
          { text: "hello", user: "U1", ts: "1" },
          { text: "world", user: "U2", ts: "2" },
        ],
      },
    });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.equal(result.length, 2);
    assert.equal(result[0].text, "hello");
    assert.equal(result[0].userId, "U1");
    assert.equal(result[0].isBot, false);
    assert.equal(result[0].ts, "1");
    assert.equal(result[1].text, "world");
    assert.equal(result[1].userId, "U2");
  });

  it("marks messages from botUserId as bot", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [{ text: "bot reply", user: "BOTU", ts: "1" }],
      },
    });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.equal(result[0].isBot, true);
  });

  it("marks messages with bot_id as bot", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [{ text: "bot msg", user: "U1", bot_id: "B1", ts: "1" }],
      },
    });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.equal(result[0].isBot, true);
  });

  it("uses bot_id as userId when user field is missing", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [{ text: "bot msg", bot_id: "B1", ts: "1" }],
      },
    });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.equal(result[0].userId, "B1");
    assert.equal(result[0].isBot, true);
  });

  it("filters out messages without text and without attachments", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [
          { user: "U1", ts: "1" } as {
            text?: string;
            user?: string;
            ts?: string;
          },
          { text: "valid", user: "U2", ts: "2" },
        ],
      },
    });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "valid");
  });

  it("filters out messages without user and without bot_id", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [
          { text: "no user", ts: "1" } as {
            text?: string;
            user?: string;
            ts?: string;
          },
          { text: "valid", user: "U1", ts: "2" },
        ],
      },
    });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.equal(result.length, 1);
  });

  it("filters out messages without ts", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [
          { text: "no ts", user: "U1" } as {
            text?: string;
            user?: string;
            ts?: string;
          },
          { text: "valid", user: "U2", ts: "2" },
        ],
      },
    });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.equal(result.length, 1);
  });

  it("uses [attachment] when extractMessageText returns empty", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [{ attachments: [{ text: "" }], user: "U1", ts: "1" }],
      },
    });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.equal(result[0].text, "[attachment]");
  });

  it("returns empty array on API error", async () => {
    const client = makeClient({ throwOnReplies: true });
    const result = await fetchThreadContext(client, "C1", "ts1", "BOTU");
    assert.deepEqual(result, []);
  });

  it("passes custom limit to conversations.replies", async () => {
    const client = makeClient({
      replies: { "C1:ts1": [{ text: "hello", user: "U1", ts: "1" }] },
    });
    await fetchThreadContext(client, "C1", "ts1", "BOTU", { limit: 50 });

    const repliesFn = client.conversations.replies as unknown as ReturnType<typeof mock.fn>;
    assert.equal(repliesFn.mock.callCount(), 1);
    const callArgs = repliesFn.mock.calls[0].arguments[0] as { limit: number };
    assert.equal(callArgs.limit, 50);
  });

  it("uses default limit of 20 when not specified", async () => {
    const client = makeClient({
      replies: { "C1:ts1": [{ text: "hello", user: "U1", ts: "1" }] },
    });
    await fetchThreadContext(client, "C1", "ts1", "BOTU");

    const repliesFn = client.conversations.replies as unknown as ReturnType<typeof mock.fn>;
    const callArgs = repliesFn.mock.calls[0].arguments[0] as { limit: number };
    assert.equal(callArgs.limit, 20);
  });
});

// ---------------------------------------------------------------------------
// fetchMessage
// ---------------------------------------------------------------------------

describe("fetchMessage", () => {
  it("fetches top-level message using conversations.history", async () => {
    const client = makeClient({
      history: {
        "C1:msg1": [{ text: "top-level message", user: "U1", ts: "msg1" }],
      },
    });
    const result = await fetchMessage(client, "C1", "msg1");
    assert.equal(result, "top-level message");
  });

  it("returns empty string when no messages in history", async () => {
    const client = makeClient({ history: {} });
    const result = await fetchMessage(client, "C1", "msg1");
    assert.equal(result, "");
  });

  it("fetches threaded message using conversations.replies when threadTs differs", async () => {
    const client = makeClient({
      replies: {
        "C1:parent1": [
          { text: "parent", user: "U1", ts: "parent1" },
          { text: "reply text", user: "U2", ts: "reply1" },
        ],
      },
    });
    const result = await fetchMessage(client, "C1", "reply1", "parent1");
    assert.equal(result, "reply text");
  });

  it("returns empty string when threaded message not found in replies", async () => {
    const client = makeClient({
      replies: {
        "C1:parent1": [{ text: "parent", user: "U1", ts: "parent1" }],
      },
    });
    const result = await fetchMessage(client, "C1", "missing_ts", "parent1");
    assert.equal(result, "");
  });

  it("uses conversations.history when threadTs equals messageTs", async () => {
    const client = makeClient({
      history: {
        "C1:ts1": [{ text: "same ts message", user: "U1", ts: "ts1" }],
      },
    });
    const result = await fetchMessage(client, "C1", "ts1", "ts1");
    assert.equal(result, "same ts message");
  });

  it("returns empty string on API error for history", async () => {
    const client = makeClient({ throwOnHistory: true });
    const result = await fetchMessage(client, "C1", "msg1");
    assert.equal(result, "");
  });

  it("returns empty string on API error for replies", async () => {
    const client = makeClient({ throwOnReplies: true });
    const result = await fetchMessage(client, "C1", "reply1", "parent1");
    assert.equal(result, "");
  });

  it("extracts text from attachments in fetched message", async () => {
    const client = makeClient({
      history: {
        "C1:msg1": [
          {
            attachments: [{ text: "attachment text" }],
            user: "U1",
            ts: "msg1",
          },
        ],
      },
    });
    const result = await fetchMessage(client, "C1", "msg1");
    assert.equal(result, "attachment text");
  });
});

// ---------------------------------------------------------------------------
// hasThreadReplies
// ---------------------------------------------------------------------------

describe("hasThreadReplies", () => {
  it("returns true when thread has replies beyond parent", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [
          { text: "parent", user: "U1", ts: "ts1" },
          { text: "reply", user: "U2", ts: "ts2" },
        ],
      },
    });
    assert.equal(await hasThreadReplies(client, "C1", "ts1"), true);
  });

  it("returns false when thread has only parent message", async () => {
    const client = makeClient({
      replies: {
        "C1:ts1": [{ text: "parent", user: "U1", ts: "ts1" }],
      },
    });
    assert.equal(await hasThreadReplies(client, "C1", "ts1"), false);
  });

  it("returns false when thread has no messages", async () => {
    const client = makeClient({ replies: { "C1:ts1": [] } });
    assert.equal(await hasThreadReplies(client, "C1", "ts1"), false);
  });

  it("returns false on API error", async () => {
    const client = makeClient({ throwOnReplies: true });
    assert.equal(await hasThreadReplies(client, "C1", "ts1"), false);
  });
});

// ---------------------------------------------------------------------------
// sendDirectMessage
// ---------------------------------------------------------------------------

describe("sendDirectMessage", () => {
  it("opens a DM conversation and posts a message", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    await sendDirectMessage(client, "U1", "hello");

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const call = postMessage.mock.calls[0].arguments[0] as {
      channel: string;
      text: string;
    };
    assert.equal(call.channel, "DM_CHAN");
    assert.equal(call.text, "hello");
  });

  it("includes blocks when provided", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "test" } }];
    await sendDirectMessage(client, "U1", "hello", blocks);

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    const call = postMessage.mock.calls[0].arguments[0] as {
      channel: string;
      text: string;
      blocks?: object[];
    };
    assert.deepEqual(call.blocks, blocks);
  });

  it("does not include blocks key when not provided", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    await sendDirectMessage(client, "U1", "hello");

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    const call = postMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal("blocks" in call, false);
  });

  it("does not post when conversations.open returns no channel", async () => {
    const client = makeClient({}); // openChannel is undefined
    await sendDirectMessage(client, "U1", "hello");

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 0);
  });

  it("does not throw on API error", async () => {
    const client = makeClient({ throwOnOpen: true });
    await assert.doesNotReject(() => sendDirectMessage(client, "U1", "hello"));
  });
});

// ---------------------------------------------------------------------------
// sendErrorReport
// ---------------------------------------------------------------------------

describe("sendErrorReport", () => {
  it("sends an error report DM with formatted blocks", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    const trace: ConversationMessage[] = [
      { type: "user", content: "help me", timestamp: 1 },
      { type: "assistant", content: "sure thing", timestamp: 2 },
    ];

    await sendErrorReport(client, "U1", {
      sessionId: "sess-1",
      errorMessage: "something broke",
      conversationTrace: trace,
      analysis: "The assistant ran into an issue",
    });

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const call = postMessage.mock.calls[0].arguments[0] as {
      channel: string;
      text: string;
      blocks: unknown[];
    };
    assert.equal(call.channel, "DM_CHAN");
    assert.ok(call.text.includes("Error Report"));
    assert.ok(Array.isArray(call.blocks));
    assert.ok(call.blocks.length > 0);
  });

  it("uploads error report as a threaded file reply", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    const trace: ConversationMessage[] = [{ type: "user", content: "help me", timestamp: 1 }];

    await sendErrorReport(client, "U1", {
      sessionId: "sess-1",
      errorMessage: "err",
      conversationTrace: trace,
      analysis: "analysis",
    });

    const filesUpload = client.filesUploadV2 as unknown as ReturnType<typeof mock.fn>;
    assert.equal(filesUpload.mock.callCount(), 1);
    const call = filesUpload.mock.calls[0].arguments[0] as {
      channel_id: string;
      thread_ts: string;
      filename: string;
      content: string;
    };
    assert.equal(call.channel_id, "DM_CHAN");
    assert.equal(call.thread_ts, "msg-ts");
    assert.ok(call.filename.includes("sess-1"));
    const parsed = JSON.parse(call.content);
    assert.equal(parsed.sessionId, "sess-1");
    assert.equal(parsed.conversationTrace.length, 1);
  });

  it("includes stderr in uploaded report when present", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });

    await sendErrorReport(client, "U1", {
      sessionId: "sess-1",
      errorMessage: "err",
      conversationTrace: [],
      stderrOutput: "some stderr",
      analysis: "analysis",
    });

    const filesUpload = client.filesUploadV2 as unknown as ReturnType<typeof mock.fn>;
    const call = filesUpload.mock.calls[0].arguments[0] as { content: string };
    const parsed = JSON.parse(call.content);
    assert.equal(parsed.stderrOutput, "some stderr");
  });

  it("does not throw on API error", async () => {
    const client = makeClient({ throwOnOpen: true });
    await assert.doesNotReject(() =>
      sendErrorReport(client, "U1", {
        sessionId: "sess-1",
        errorMessage: "err",
        conversationTrace: [],
        analysis: "analysis",
      }),
    );
  });
});
