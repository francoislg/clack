import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { extractMessageText } from "./messageBuilder.js";
import {
  fetchThreadContext,
  fetchMessage,
  hasThreadReplies,
  sendDirectMessage,
  sendErrorReport,
} from "./messagesApi.js";
import type { ConversationMessage } from "../claude/index.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";

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

type ConversationMessageFixture = NonNullable<
  Awaited<ReturnType<MockSlackClient["conversations"]["replies"]>>["messages"]
>[number];

interface MockConversationsConfig {
  replies?: Record<string, ConversationMessageFixture[]>;
  history?: Record<string, ConversationMessageFixture[]>;
  openChannel?: string;
  throwOnReplies?: boolean;
  throwOnHistory?: boolean;
  throwOnOpen?: boolean;
}

type PostMessageArgs = Parameters<MockSlackClient["chat"]["postMessage"]>[0];
type FilesUploadArgs = Parameters<MockSlackClient["filesUploadV2"]>[0];

function messageText(call: PostMessageArgs): string | undefined {
  return "text" in call ? call.text : undefined;
}

function messageBlocks(call: PostMessageArgs) {
  return "blocks" in call ? call.blocks : undefined;
}

function uploadContent(call: FilesUploadArgs): string | undefined {
  return "content" in call ? call.content : undefined;
}

function uploadThreadTs(call: FilesUploadArgs): string | undefined {
  return "thread_ts" in call ? call.thread_ts : undefined;
}

function getPostMessageCall(client: MockSlackClient, index: number): PostMessageArgs {
  const call = client.chat.postMessage.mock.calls[index];
  if (!call) throw new Error(`client.chat.postMessage call ${index} not found`);
  return call[0];
}

function getFilesUploadCall(client: MockSlackClient, index: number): FilesUploadArgs {
  const call = client.filesUploadV2.mock.calls[index];
  if (!call) throw new Error(`client.filesUploadV2 call ${index} not found`);
  return call[0];
}

function makeClient(config: MockConversationsConfig = {}): MockSlackClient {
  const client = createSlackClientMock();

  client.conversations.replies.mockImplementation(async ({ channel, ts }) => {
    if (config.throwOnReplies) throw new Error("replies_error");
    const key = `${channel}:${ts}`;
    return { ok: true, messages: config.replies?.[key] ?? [] };
  });

  client.conversations.history.mockImplementation(async ({ channel, latest }) => {
    if (config.throwOnHistory) throw new Error("history_error");
    const key = `${channel}:${latest}`;
    return { ok: true, messages: config.history?.[key] ?? [] };
  });

  client.conversations.open.mockImplementation(async () => {
    if (config.throwOnOpen) throw new Error("open_error");
    return {
      ok: true,
      channel: config.openChannel ? { id: config.openChannel } : undefined,
    };
  });

  client.chat.postMessage.mockResolvedValue({ ok: true, ts: "msg-ts" });
  client.filesUploadV2.mockResolvedValue({ ok: true, files: [] });
  client.users.info.mockResolvedValue({ ok: false });
  client.bots.info.mockResolvedValue({ ok: false });

  return client;
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

    const repliesFn = vi.mocked(client.conversations.replies);
    assert.equal(repliesFn.mock.calls.length, 1);
    const callArgs = repliesFn.mock.calls[0][0];
    assert.equal(callArgs.limit, 50);
  });

  it("uses default limit of 20 when not specified", async () => {
    const client = makeClient({
      replies: { "C1:ts1": [{ text: "hello", user: "U1", ts: "1" }] },
    });
    await fetchThreadContext(client, "C1", "ts1", "BOTU");

    const repliesFn = vi.mocked(client.conversations.replies);
    const callArgs = repliesFn.mock.calls[0][0];
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

    assert.equal(vi.mocked(client.chat.postMessage).mock.calls.length, 1);
    const call = getPostMessageCall(client, 0);
    assert.equal(call.channel, "DM_CHAN");
    assert.equal(messageText(call), "hello");
  });

  it("includes blocks when provided", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "test" } }];
    await sendDirectMessage(client, "U1", "hello", blocks);

    const call = getPostMessageCall(client, 0);
    assert.deepEqual(messageBlocks(call), blocks);
  });

  it("does not include blocks key when not provided", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    await sendDirectMessage(client, "U1", "hello");

    const call = getPostMessageCall(client, 0);
    assert.equal("blocks" in call, false);
  });

  it("does not post when conversations.open returns no channel", async () => {
    const client = makeClient({}); // openChannel is undefined
    await sendDirectMessage(client, "U1", "hello");

    assert.equal(vi.mocked(client.chat.postMessage).mock.calls.length, 0);
  });

  it("does not throw on API error", async () => {
    const client = makeClient({ throwOnOpen: true });
    await assert.doesNotReject(() => sendDirectMessage(client, "U1", "hello"));
  });

  it("omits unfurl_links and unfurl_media when suppressUnfurls is not set", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    await sendDirectMessage(client, "U1", "hello");
    const call = getPostMessageCall(client, 0);
    assert.equal("unfurl_links" in call, false);
    assert.equal("unfurl_media" in call, false);
  });

  it("sets unfurl_links and unfurl_media to false when suppressUnfurls is true", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    await sendDirectMessage(client, "U1", "hello", undefined, { suppressUnfurls: true });
    const call = getPostMessageCall(client, 0);
    assert.equal(call.unfurl_links, false);
    assert.equal(call.unfurl_media, false);
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

    assert.equal(vi.mocked(client.chat.postMessage).mock.calls.length, 1);
    const call = getPostMessageCall(client, 0);
    assert.equal(call.channel, "DM_CHAN");
    assert.ok(messageText(call)?.includes("Error Report"));
    const blocks = messageBlocks(call);
    assert.ok(Array.isArray(blocks));
    assert.ok(Array.isArray(blocks) && blocks.length > 0);
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

    assert.equal(vi.mocked(client.filesUploadV2).mock.calls.length, 1);
    const call = getFilesUploadCall(client, 0);
    assert.equal(call.channel_id, "DM_CHAN");
    assert.equal(uploadThreadTs(call), "msg-ts");
    assert.ok(call.filename?.includes("sess-1"));
    const parsed = JSON.parse(uploadContent(call) ?? "");
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

    const call = getFilesUploadCall(client, 0);
    const parsed = JSON.parse(uploadContent(call) ?? "");
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

  it("omits unfurl_links and unfurl_media when suppressUnfurls is not set", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    await sendErrorReport(client, "U1", {
      sessionId: "sess-1",
      errorMessage: "err",
      conversationTrace: [],
      analysis: "analysis",
    });
    const call = getPostMessageCall(client, 0);
    assert.equal("unfurl_links" in call, false);
    assert.equal("unfurl_media" in call, false);
  });

  it("sets unfurl_links and unfurl_media to false when suppressUnfurls is true", async () => {
    const client = makeClient({ openChannel: "DM_CHAN" });
    await sendErrorReport(
      client,
      "U1",
      {
        sessionId: "sess-1",
        errorMessage: "err",
        conversationTrace: [],
        analysis: "analysis",
      },
      { suppressUnfurls: true },
    );
    const call = getPostMessageCall(client, 0);
    assert.equal(call.unfurl_links, false);
    assert.equal(call.unfurl_media, false);
  });
});
