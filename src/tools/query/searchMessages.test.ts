import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import {
  createSearchMessagesTool,
  type SearchMessagesDeps,
  type SearchContextArgs,
} from "./searchMessages.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";

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
