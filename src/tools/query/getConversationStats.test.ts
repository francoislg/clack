import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createGetConversationStatsTool } from "./getConversationStats.js";
import type { ConversationStatsDeps } from "./conversationStats/scan.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";

function makeCtx(over: Partial<QueryToolContext> = {}): QueryToolContext {
  return { userId: "U1", ...over } as QueryToolContext;
}

function makeDeps(): ConversationStatsDeps {
  const body = JSON.stringify({
    sessionId: "C1-1-1-U1-1000",
    channelId: "C1",
    userId: "U1",
    createdAt: 1000,
    trigger: { type: "mentions", messageText: "hi" },
    messages: [{ role: "assistant", ts: 0, text: "yo" }],
  });
  return {
    readdir: vi.fn(async () => ["C1-1-1-U1-1000"]),
    readFile: vi.fn(async () => body),
    fileExists: vi.fn(async () => true),
    getSessionsDir: () => "/sessions",
    now: () => 2_000_000_000_000,
  };
}

describe("get_conversation_stats tool", () => {
  it("returns the stats bundle as a JSON tool result", async () => {
    const toolDef = createGetConversationStatsTool(makeCtx(), makeDeps());
    const parsed = parseToolResult(
      await toolDef.handler({ from: undefined, to: undefined }, { sessionId: "t" }),
    );
    assert.equal(parsed.totals.sessions, 1);
    assert.equal(parsed.core.topAskers[0].userId, "U1");
    assert.deepEqual(parsed.range, { from: null, to: null, sessionsScanned: 1 });
  });

  it("threads from/to into the window", async () => {
    const toolDef = createGetConversationStatsTool(makeCtx(), makeDeps());
    const parsed = parseToolResult(
      await toolDef.handler({ from: 5000, to: 9000 }, { sessionId: "t" }),
    );
    assert.equal(parsed.totals.sessions, 0);
    assert.deepEqual(parsed.range, { from: 5000, to: 9000, sessionsScanned: 0 });
  });
});
