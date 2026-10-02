import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createSearchMessagesTool,
  type SearchMessagesDeps,
  type SearchContextArgs,
} from "./searchMessages.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { checkConversationAccess } from "../../slack/requesterAccess.js";

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkConversationAccess: vi.fn() };
});

beforeEach(() => {
  vi.mocked(checkConversationAccess).mockReset();
  vi.mocked(checkConversationAccess).mockResolvedValue({ allowed: true });
});

function makeCtx(opts: { actionToken?: string; hasSlackClient?: boolean } = {}): QueryToolContext {
  const ctx: QueryToolContext = Object.assign(Object.create(null), {
    mode: "query",
    userId: "U1",
    role: "member",
    session: {
      sessionId: "s1",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U1",
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: { repositories: [], allowPublicSearch: true },
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    slackClient: opts.hasSlackClient === false ? undefined : {},
    actionToken: opts.actionToken,
  });
  return ctx;
}

function makeDeps(impl: SearchMessagesDeps["searchContext"]): {
  deps: SearchMessagesDeps;
  searchContext: ReturnType<typeof vi.fn>;
} {
  const searchContext = vi.fn(impl);
  return { deps: { searchContext }, searchContext };
}

const sampleMessage = {
  author_user_id: "U999",
  channel_id: "C123",
  channel_name: "general",
  message_ts: "1700000000.000100",
  content: "the retry bug is back :bob:",
  permalink: "https://slack.example/archives/C123/p1700000000000100",
  is_author_bot: false,
};

describe("search_messages — full shape (action_token present)", () => {
  it("calls assistant.search.context with the fixed literal-search arguments", async () => {
    const { deps, searchContext } = makeDeps(async () => ({
      ok: true,
      results: { messages: [sampleMessage] },
    }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    assert.deepEqual(Object.keys(toolDef.inputSchema), ["query"]);

    const result = await toolDef.handler({ query: ":bob:" }, { sessionId: "s1" });

    expect(searchContext).toHaveBeenCalledTimes(1);
    const [, args] = searchContext.mock.calls[0] as [unknown, SearchContextArgs];
    assert.equal(args.query, ":bob:");
    assert.equal(args.action_token, "AT-1");
    assert.equal(args.disable_semantic_search, true);
    assert.equal(args.channel_types, "public_channel");
    assert.equal(args.content_types, "messages");
    assert.equal(args.limit, 20);

    const parsed = parseToolResult(result);
    assert.equal(parsed.match_count, 1);
    assert.equal(parsed.truncated, false);
    assert.equal(parsed.messages[0].text, "the retry bug is back :bob:");
    assert.equal(parsed.messages[0].permalink, sampleMessage.permalink);
  });

  it("forwards Slack search operators in the query unmodified", async () => {
    const { deps, searchContext } = makeDeps(async () => ({ ok: true, results: { messages: [] } }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    await toolDef.handler(
      { query: "deploy in:<#C0123> from:<@U0123> before:2026-01-01" },
      { sessionId: "s1" },
    );

    const [, args] = searchContext.mock.calls[0] as [unknown, SearchContextArgs];
    assert.equal(args.query, "deploy in:<#C0123> from:<@U0123> before:2026-01-01");
  });

  it("returns an empty result set (not an error) when Slack matches nothing", async () => {
    const { deps } = makeDeps(async () => ({ ok: true, results: { messages: [] } }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    const result = await toolDef.handler({ query: "nothingmatches" }, { sessionId: "s1" });

    assert.notEqual(result.isError, true);
    const parsed = parseToolResult(result);
    assert.equal(parsed.match_count, 0);
    assert.equal(parsed.truncated, false);
    assert.deepEqual(parsed.messages, []);
  });

  it("signals truncation when Slack returns a next_cursor", async () => {
    const { deps } = makeDeps(async () => ({
      ok: true,
      results: { messages: [sampleMessage] },
      response_metadata: { next_cursor: "abc" },
    }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    const result = await toolDef.handler({ query: "retry" }, { sessionId: "s1" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.truncated, true);
    assert.ok(typeof parsed.truncation_note === "string");
  });

  it("signals truncation when the result count hits the per-call cap", async () => {
    const full = Array.from({ length: 20 }, () => sampleMessage);
    const { deps } = makeDeps(async () => ({ ok: true, results: { messages: full } }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    const parsed = parseToolResult(await toolDef.handler({ query: "retry" }, { sessionId: "s1" }));
    assert.equal(parsed.truncated, true);
  });

  it("surfaces missing_scope distinctly from empty results and names the reinstall", async () => {
    const { deps } = makeDeps(async () => {
      throw Object.assign(new Error("An API error occurred: missing_scope"), {
        data: { ok: false, error: "missing_scope" },
      });
    });
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    const result = await toolDef.handler({ query: "retry" }, { sessionId: "s1" });

    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /search:read\.public/);
    assert.match(parsed.error, /reinstall/i);
    assert.doesNotMatch(parsed.error, /no results|nothing matched/i);
  });

  it("rejects an empty query without calling Slack", async () => {
    const { deps, searchContext } = makeDeps(async () => ({ ok: true, results: { messages: [] } }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    const result = await toolDef.handler({ query: "   " }, { sessionId: "s1" });

    assert.equal(result.isError, true);
    expect(searchContext).not.toHaveBeenCalled();
  });
});

describe("search_messages — requester access", () => {
  const inChannel = (channelId: string, content: string) => ({
    ...sampleMessage,
    channel_id: channelId,
    channel_name: `name-${channelId}`,
    content,
  });

  it("drops results from denied channels and keeps the rest", async () => {
    vi.mocked(checkConversationAccess).mockImplementation(async (_req, channelId) =>
      channelId === "CDENIED" ? { allowed: false, reason: "not_member" } : { allowed: true },
    );
    const { deps } = makeDeps(async () => ({
      ok: true,
      results: {
        messages: [
          inChannel("COPEN", "open one"),
          inChannel("CDENIED", "hidden one"),
          inChannel("COPEN", "open two"),
          inChannel("CDENIED", "hidden two"),
          inChannel("COTHER", "other one"),
        ],
      },
    }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    const result = await toolDef.handler({ query: "one" }, { sessionId: "s1" });

    assert.notEqual(result.isError, true);
    const parsed = parseToolResult(result);
    assert.equal(parsed.match_count, 3);
    assert.deepEqual(
      parsed.messages.map((m: { text: string }) => m.text),
      ["open one", "open two", "other one"],
    );
    assert.ok(parsed.messages.every((m: { channel: string }) => m.channel !== "CDENIED"));
    assert.doesNotMatch(JSON.stringify(parsed), /CDENIED|hidden/);
  });

  it("checks each distinct channel once, with the context's requester and session", async () => {
    const ctx = makeCtx({ actionToken: "AT-1" });
    const { deps } = makeDeps(async () => ({
      ok: true,
      results: {
        messages: [inChannel("CA", "a1"), inChannel("CB", "b1"), inChannel("CA", "a2")],
      },
    }));
    const toolDef = createSearchMessagesTool(ctx, deps);

    await toolDef.handler({ query: "x" }, { sessionId: "s1" });

    const calls = vi.mocked(checkConversationAccess).mock.calls;
    assert.deepEqual(
      calls.map(([, channelId]) => channelId),
      ["CA", "CB"],
    );
    const [req] = calls[0];
    assert.equal(req.client, ctx.slackClient);
    assert.equal(req.userId, "U1");
    assert.equal(req.role, "member");
    assert.equal(req.session, ctx.session);
  });

  it("drops a result that carries no channel id", async () => {
    const { channel_id: _channelId, ...noChannel } = sampleMessage;
    const { deps } = makeDeps(async () => ({
      ok: true,
      results: { messages: [noChannel, sampleMessage] },
    }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    const parsed = parseToolResult(await toolDef.handler({ query: "x" }, { sessionId: "s1" }));

    assert.equal(parsed.match_count, 1);
    assert.equal(parsed.messages[0].channel, "C123");
    expect(checkConversationAccess).toHaveBeenCalledTimes(1);
  });

  it("computes truncated from the unfiltered response", async () => {
    vi.mocked(checkConversationAccess).mockResolvedValue({ allowed: false, reason: "not_member" });
    const full = Array.from({ length: 20 }, () => sampleMessage);
    const { deps } = makeDeps(async () => ({ ok: true, results: { messages: full } }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    const parsed = parseToolResult(await toolDef.handler({ query: "x" }, { sessionId: "s1" }));

    assert.equal(parsed.match_count, 0);
    assert.deepEqual(parsed.messages, []);
    assert.equal(parsed.truncated, true);
  });

  it("makes no access check when the search itself fails", async () => {
    const { deps } = makeDeps(async () => ({ ok: false, error: "ratelimited" }));
    const toolDef = createSearchMessagesTool(makeCtx({ actionToken: "AT-1" }), deps);

    const result = await toolDef.handler({ query: "x" }, { sessionId: "s1" });

    assert.equal(result.isError, true);
    expect(checkConversationAccess).not.toHaveBeenCalled();
  });
});

describe("search_messages — degraded shape (no action_token)", () => {
  it("omits the query parameter from its schema", () => {
    const toolDef = createSearchMessagesTool(makeCtx(), makeDeps(async () => ({})).deps);
    assert.deepEqual(Object.keys(toolDef.inputSchema), []);
  });

  it("returns an error naming DM and @mention, making no Slack call", async () => {
    const { deps, searchContext } = makeDeps(async () => ({ ok: true, results: { messages: [] } }));
    const toolDef = createSearchMessagesTool(makeCtx(), deps);

    // The degraded tool ignores args; the union handler type still requires the `query` key.
    const result = await toolDef.handler({ query: "ignored" }, { sessionId: "s1" });

    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /direct message/i);
    assert.match(parsed.error, /@mention|mention/i);
    expect(searchContext).not.toHaveBeenCalled();
  });
});
