import { describe, it, vi, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import { createFetchSlackMessageTool, type FetchSlackMessageDeps } from "./fetchSlackMessage.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { SlackFileRef, SlackRef } from "../../slack/slackRefs.js";
import type { EmojiCache } from "../../slack/emojiCache.js";
import { buildLoreHint } from "../../emojiLore.js";
import { stub } from "../../testStubs.js";
import {
  ACCESS_DENIED_MESSAGE,
  checkConversationAccess,
  checkFileAccess,
} from "../../slack/requesterAccess.js";

// The lore store is an outside dependency: stub the hint builder and assert the wiring.
vi.mock("../../emojiLore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../emojiLore.js")>();
  return { ...actual, buildLoreHint: vi.fn() };
});

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkConversationAccess: vi.fn(), checkFileAccess: vi.fn() };
});

beforeEach(() => {
  vi.mocked(checkFileAccess).mockReset();
  vi.mocked(checkConversationAccess).mockReset();
  vi.mocked(checkConversationAccess).mockResolvedValue({ allowed: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<FetchSlackMessageDeps> = {}): FetchSlackMessageDeps {
  return {
    fetchThreadContext: vi.fn(async () => []) as FetchSlackMessageDeps["fetchThreadContext"],
    getChannelInfo: vi.fn(async () => ({
      id: "C0123ABC",
      name: "general",
    })) as FetchSlackMessageDeps["getChannelInfo"],
    resolveSlackRefs: vi.fn<FetchSlackMessageDeps["resolveSlackRefs"]>(async () => []),
    ...overrides,
  };
}

/** A resolved file ref, as the resolver would return it for a fetched message. */
function fileRef(
  id: string,
  name: string,
  kind: SlackFileRef["kind"],
  reader: string,
): SlackFileRef {
  return {
    type: "file",
    id,
    name,
    kind,
    label: kind,
    reader,
    mustOpen: kind === "image",
    fromCurrentMessage: false,
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
    config: stub<QueryToolContext["config"]>({
      repositories: [],
    }),
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    slackClient: stub<NonNullable<QueryToolContext["slackClient"]>>({}),
    availableRefs: new Map(),
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

  it("refuses a value that is no Slack reference without a Slack call", async () => {
    const deps = makeDeps();
    const toolDef = createFetchSlackMessageTool(makeCtx(), deps);

    const result = await toolDef.handler(
      { url: "not-a-url", page: undefined, limit: undefined },
      { sessionId: "test" },
    );

    assert.equal(result.isError, true);
    assert.ok(parseToolResult(result).error.includes("is not a Slack reference"));
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(deps.fetchThreadContext).not.toHaveBeenCalled();
  });

  it("refuses a non-Slack URL", async () => {
    const toolDef = createFetchSlackMessageTool(makeCtx(), makeDeps());

    const result = await toolDef.handler(
      { url: "https://example.com/page", page: undefined, limit: undefined },
      { sessionId: "test" },
    );

    assert.equal(result.isError, true);
    assert.ok(parseToolResult(result).error.includes("is not a Slack reference"));
  });

  it("redirects a file id to its reader without reading messages", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "read",
      creator: "U1",
      facts: { mimetype: "image/png" },
    });
    const deps = makeDeps();
    const toolDef = createFetchSlackMessageTool(makeCtx(), deps);

    const result = await toolDef.handler(
      { url: "F0IMAGE01", page: undefined, limit: undefined },
      { sessionId: "test" },
    );

    assert.equal(result.isError, true);
    expect(parseToolResult(result).error).toBe('"F0IMAGE01" is an Image: use view_slack_file');
    expect(deps.fetchThreadContext).not.toHaveBeenCalled();
  });

  it("uses a registered permalink with no file access check", async () => {
    const deps = makeDeps({
      fetchThreadContext: vi.fn(async () =>
        makeThreadMessages(1),
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });
    const ctx = makeCtx();
    ctx.availableRefs?.set("C0123ABC:1234567890.123456", {
      type: "message",
      id: "C0123ABC:1234567890.123456",
      kind: "message",
      label: "Slack message",
      reader: "fetch_slack_message",
      mustOpen: false,
      channelId: "C0123ABC",
      ts: "1234567890.123456",
      fromCurrentMessage: true,
    });
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(deps.fetchThreadContext).toHaveBeenCalledWith(
      ctx.slackClient,
      "C0123ABC",
      "1234567890.123456",
      "",
      expect.anything(),
    );
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
      fetchThreadContext: vi.fn(async () =>
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
      fetchThreadContext: vi.fn(
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
      fetchThreadContext: vi.fn(async () =>
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
      fetchThreadContext: vi.fn(
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
      fetchThreadContext: vi.fn(
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
      fetchThreadContext: vi.fn(
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
    const fetchThreadContextFn = vi.fn<FetchSlackMessageDeps["fetchThreadContext"]>(
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
    const callArgs = fetchThreadContextFn.mock.calls[0];
    assert.equal(callArgs[2], "1111111111.000000");
  });

  // --- Empty result ---

  it("returns error when thread fetch returns empty", async () => {
    const deps = makeDeps({
      fetchThreadContext: vi.fn(async () => []) as FetchSlackMessageDeps["fetchThreadContext"],
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
      fetchThreadContext: vi.fn(async () =>
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
      fetchThreadContext: vi.fn(
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
        files: [imageFile],
      },
    ];
    const deps = makeDeps({
      fetchThreadContext: vi.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const imageRef = fileRef("F123", "screenshot.png", "image", "view_slack_file");
    vi.mocked(deps.resolveSlackRefs).mockResolvedValue([imageRef]);
    const availableRefs = new Map<string, SlackRef>();
    const ctx = makeCtx({ availableRefs });
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    expect(deps.resolveSlackRefs).toHaveBeenCalledWith(
      { client: ctx.slackClient, userId: "U123", role: "dev", session: ctx.session },
      {
        text: "Check this",
        files: [imageFile],
        fromCurrentMessage: false,
        gates: { listsMode: "off", canvasesMode: "off" },
      },
    );
    const parsed = parseToolResult(result);
    assert.deepEqual(parsed.messages[0].files, [
      { file_id: "F123", name: "screenshot.png", kind: "image", reader: "view_slack_file" },
    ]);
    assert.equal("images" in parsed.messages[0], false);
    assert.equal(availableRefs.get("F123"), imageRef);
  });

  it("registers a ref found in a fetched message's text", async () => {
    const messages = [
      {
        text: "Notes in https://acme.slack.com/docs/T0123/F0CANVAS1",
        userId: "U1",
        ts: "1.0",
        isBot: false,
        displayName: "Alice",
      },
    ];
    const deps = makeDeps({
      fetchThreadContext: vi.fn<FetchSlackMessageDeps["fetchThreadContext"]>(async () => messages),
    });
    const canvasRef = fileRef("F0CANVAS1", "Notes", "canvas", "read_canvas");
    vi.mocked(deps.resolveSlackRefs).mockResolvedValue([canvasRef]);
    const availableRefs = new Map<string, SlackRef>();
    const ctx = makeCtx({
      availableRefs,
      config: stub<QueryToolContext["config"]>({ repositories: [], canvases: { mode: "read" } }),
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

    expect(deps.resolveSlackRefs).toHaveBeenCalledWith(expect.anything(), {
      text: "Notes in https://acme.slack.com/docs/T0123/F0CANVAS1",
      files: undefined,
      fromCurrentMessage: false,
      gates: { listsMode: "off", canvasesMode: "read" },
    });
    assert.equal(availableRefs.get("F0CANVAS1"), canvasRef);
    assert.deepEqual(parseToolResult(result).messages[0].files, [
      { file_id: "F0CANVAS1", name: "Notes", kind: "canvas", reader: "read_canvas" },
    ]);
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
      fetchThreadContext: vi.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const pdfRef = fileRef("F456", "doc.pdf", "document", "view_slack_file");
    vi.mocked(deps.resolveSlackRefs).mockResolvedValue([pdfRef]);
    const availableRefs = new Map<string, SlackRef>();
    const ctx = makeCtx({ availableRefs });
    const toolDef = createFetchSlackMessageTool(ctx, deps);

    const result = await toolDef.handler(
      {
        url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
        page: undefined,
        limit: undefined,
      },
      { sessionId: "test" },
    );

    expect(deps.resolveSlackRefs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ files: [file], fromCurrentMessage: false }),
    );
    const parsed = parseToolResult(result);
    assert.deepEqual(parsed.messages[0].files, [
      { file_id: "F456", name: "doc.pdf", kind: "document", reader: "view_slack_file" },
    ]);
    assert.equal(availableRefs.get("F456"), pdfRef);
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
        files: [page0Image],
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
        files: [page1Image],
      },
    ];
    const deps = makeDeps({
      fetchThreadContext: vi.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx();
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

    // Only the page's one message (no files) is resolved; the overfetched ones are not
    expect(deps.resolveSlackRefs).toHaveBeenCalledTimes(1);
    expect(deps.resolveSlackRefs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: "Msg 1", files: undefined }),
    );
  });

  // --- User display name fallback ---

  it("falls back to username when displayName is absent", async () => {
    const messages = [{ text: "Hello", userId: "U1", ts: "1.0", isBot: false, username: "bob" }];
    const deps = makeDeps({
      fetchThreadContext: vi.fn(
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
      fetchThreadContext: vi.fn(
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

  it("works when availableRefs is undefined", async () => {
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
        files: [imageFile],
      },
    ];
    const deps = makeDeps({
      fetchThreadContext: vi.fn(
        async () => messages,
      ) as FetchSlackMessageDeps["fetchThreadContext"],
    });

    const ctx = makeCtx({ availableRefs: undefined });
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

  it("omits the files key when message has no references", async () => {
    const messages = makeThreadMessages(1);
    const deps = makeDeps({
      fetchThreadContext: vi.fn(
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
      fetchThreadContext: vi.fn(
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
      fetchThreadContext: vi.fn(
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
    const fetchThreadContextFn = vi.fn<FetchSlackMessageDeps["fetchThreadContext"]>(async () =>
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

    const callArgs = fetchThreadContextFn.mock.calls[0];
    const options = callArgs[4];
    // (0+1)*5+1 = 6
    assert.equal(options?.limit, 6);
  });

  it("passes correct limit to fetchThreadContext for custom page/limit", async () => {
    const fetchThreadContextFn = vi.fn<FetchSlackMessageDeps["fetchThreadContext"]>(async () =>
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

    const callArgs = fetchThreadContextFn.mock.calls[0];
    const options = callArgs[4];
    // (2+1)*10+1 = 31
    assert.equal(options?.limit, 31);
  });

  it("includes channel_name in result when resolved", async () => {
    const deps = makeDeps({
      getChannelInfo: vi.fn(async () => ({
        id: "C0123ABC",
        name: "backend-dev",
      })) as FetchSlackMessageDeps["getChannelInfo"],
      fetchThreadContext: vi.fn(async () =>
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
      getChannelInfo: vi.fn(async () => undefined) as FetchSlackMessageDeps["getChannelInfo"],
      fetchThreadContext: vi.fn(async () =>
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

describe("fetchSlackMessage requester access", () => {
  const args = {
    url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
    page: undefined,
    limit: undefined,
  };

  it("returns the access-denied error and fetches nothing when denied", async () => {
    vi.mocked(checkConversationAccess).mockResolvedValue({ allowed: false, reason: "not_member" });
    const fetchThreadContext = vi.fn<FetchSlackMessageDeps["fetchThreadContext"]>(async () =>
      makeThreadMessages(3),
    );
    const getChannelInfo = vi.fn<FetchSlackMessageDeps["getChannelInfo"]>(async () => ({
      id: "C0123ABC",
      name: "secret-plans",
      purpose: "Top secret roadmap",
    }));
    const toolDef = createFetchSlackMessageTool(
      makeCtx(),
      makeDeps({ fetchThreadContext, getChannelInfo }),
    );

    const result = await toolDef.handler(args, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.equal(parsed.error, ACCESS_DENIED_MESSAGE);
    assert.equal(fetchThreadContext.mock.calls.length, 0);
    assert.equal(getChannelInfo.mock.calls.length, 0);
    assert.ok(!parsed.error.includes("secret-plans"));
    assert.ok(!parsed.error.includes("Top secret roadmap"));
  });

  it("checks the URL's channel with the context's requester and session", async () => {
    const ctx = makeCtx();
    const fetchThreadContext: FetchSlackMessageDeps["fetchThreadContext"] = async () =>
      makeThreadMessages(1);
    const toolDef = createFetchSlackMessageTool(ctx, makeDeps({ fetchThreadContext }));

    await toolDef.handler(args, { sessionId: "test" });

    const calls = vi.mocked(checkConversationAccess).mock.calls;
    assert.equal(calls.length, 1);
    const [req, channelId] = calls[0];
    assert.equal(channelId, "C0123ABC");
    assert.equal(req.client, ctx.slackClient);
    assert.equal(req.userId, "U123");
    assert.equal(req.role, "dev");
    assert.equal(req.session, ctx.session);
  });

  it("returns the thread when allowed", async () => {
    vi.mocked(checkConversationAccess).mockResolvedValue({ allowed: true });
    const fetchThreadContext = vi.fn<FetchSlackMessageDeps["fetchThreadContext"]>(async () =>
      makeThreadMessages(3),
    );
    const toolDef = createFetchSlackMessageTool(makeCtx(), makeDeps({ fetchThreadContext }));

    const result = await toolDef.handler(args, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(result.isError, undefined);
    assert.equal(parsed.channel, "C0123ABC");
    assert.equal(parsed.channel_name, "general");
    assert.equal(parsed.thread_ts, "1234567890.123456");
    assert.equal(parsed.message_count, 3);
    assert.equal(parsed.has_more, false);
    assert.equal(parsed.messages[0].user, "User 0");
    assert.equal(fetchThreadContext.mock.calls.length, 1);
  });
});

describe("fetchSlackMessage emoji lore hint", () => {
  const emojiCache: EmojiCache = {
    get: vi.fn(async () => undefined),
    has: vi.fn(async () => true),
    search: vi.fn(async () => ({ emojis: [], total: 0, truncated: false })),
  };

  beforeEach(() => {
    vi.mocked(buildLoreHint).mockClear();
  });

  async function fetchWith(text: string, cache?: EmojiCache) {
    const messages = makeThreadMessages(1);
    messages[0].text = text;
    const fetchThreadContext: FetchSlackMessageDeps["fetchThreadContext"] = async () => messages;
    const toolDef = createFetchSlackMessageTool(makeCtx(), makeDeps({ fetchThreadContext }), cache);

    return parseToolResult(
      await toolDef.handler(
        {
          url: "https://workspace.slack.com/archives/C0123ABC/p1234567890123456",
          page: undefined,
          limit: undefined,
        },
        { sessionId: "test" },
      ),
    );
  }

  it("passes the emoji it saw to the hint builder and surfaces the hint", async () => {
    vi.mocked(buildLoreHint).mockResolvedValue("lore nudge");

    const parsed = await fetchWith("great work :ship_it:", emojiCache);

    assert.equal(parsed.lore_hint, "lore nudge");
    const [names, passedCache] = vi.mocked(buildLoreHint).mock.calls[0];
    assert.deepEqual([...names], ["ship_it"]);
    assert.equal(passedCache, emojiCache);
  });

  it("omits lore_hint entirely when the builder has nothing to say", async () => {
    vi.mocked(buildLoreHint).mockResolvedValue(null);

    const parsed = await fetchWith("plain message", emojiCache);

    assert.equal("lore_hint" in parsed, false);
  });

  it("never builds a hint when no emoji cache is available", async () => {
    vi.mocked(buildLoreHint).mockResolvedValue("should not appear");

    const parsed = await fetchWith("hi :ship_it:");

    assert.equal("lore_hint" in parsed, false);
    assert.equal(vi.mocked(buildLoreHint).mock.calls.length, 0);
  });
});
