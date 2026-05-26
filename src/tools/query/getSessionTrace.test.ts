import { describe, it, vi } from "vitest";
import { parseToolResult } from "../testHelpers.js";
import assert from "node:assert/strict";
import { createGetSessionTraceTool, type GetSessionTraceDeps } from "./getSessionTrace.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestCtx {
  mode: "query";
  userId: string;
  role: string;
}

function makeCtx(): TestCtx {
  return {
    mode: "query",
    userId: "U123",
    role: "admin",
  };
}

function makeDeps(overrides: Partial<GetSessionTraceDeps> = {}): GetSessionTraceDeps {
  return {
    getSession: vi.fn(async () => null) as GetSessionTraceDeps["getSession"],
    getActiveChange: vi.fn(() => undefined) as GetSessionTraceDeps["getActiveChange"],
    getRepositoriesDir: () => "/repos",
    readFile: vi.fn(async () => "") as GetSessionTraceDeps["readFile"],
    ...overrides,
  };
}

function callTool(
  ctx: TestCtx,
  deps: GetSessionTraceDeps,
  args: { sessionId: string; verbose?: boolean; source?: "qa" | "change" },
) {
  const toolDef = createGetSessionTraceTool(ctx as never, deps);
  return toolDef.handler(
    { sessionId: args.sessionId, verbose: args.verbose, source: args.source },
    { sessionId: "test" },
  );
}

interface JsonlEntry {
  type: string;
  subtype?: string;
  message?: {
    content:
      | string
      | Array<{ type: string; name?: string; text?: string; input?: { [key: string]: string } }>;
  };
  timestamp?: string;
  result?: string;
}

function makeJsonlContent(entries: JsonlEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("get_session_trace", () => {
  it("returns error when session not found", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps, { sessionId: "nonexistent" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("not found"));
  });

  it("returns error when no sdkSessionId on session", async () => {
    const getSession: GetSessionTraceDeps["getSession"] = async () => ({
      sessionId: "test-session",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U1",
      trigger: { type: "mentions" as const, userId: "U1", messageTs: "1.0", messageText: "q" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    });
    const deps = makeDeps({ getSession });

    const result = await callTool(makeCtx(), deps, { sessionId: "test-session" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("No SDK session ID"));
  });

  it("returns trace for session with sdkSessionId", async () => {
    const jsonl = makeJsonlContent([
      { type: "user", message: { content: "hello" }, timestamp: "2026-01-01T00:00:00Z" },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/foo.ts" } }] },
        timestamp: "2026-01-01T00:00:01Z",
      },
      { type: "result", subtype: "success", result: "done", timestamp: "2026-01-01T00:00:02Z" },
    ]);

    const getSession: GetSessionTraceDeps["getSession"] = async () => ({
      sessionId: "test-session",
      sdkSessionId: "sdk-uuid-123",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U1",
      trigger: { type: "mentions" as const, userId: "U1", messageTs: "1.0", messageText: "q" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    });
    const deps = makeDeps({
      getSession,
      readFile: vi.fn(async () => jsonl) as GetSessionTraceDeps["readFile"],
    });

    const result = await callTool(makeCtx(), deps, { sessionId: "test-session" });
    const parsed = parseToolResult(result);

    assert.equal(parsed.sdkSessionId, "sdk-uuid-123");
    assert.equal(parsed.totalMessages, 3);
    assert.equal(parsed.trace[1].toolName, "Read");
  });

  it("returns change execution trace when source is 'change'", async () => {
    const jsonl = makeJsonlContent([
      { type: "assistant", message: { content: [{ type: "text", text: "implementing..." }] } },
    ]);

    const getSession: GetSessionTraceDeps["getSession"] = async () => ({
      sessionId: "test-session",
      sdkSessionId: "qa-uuid",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U1",
      trigger: { type: "mentions" as const, userId: "U1", messageTs: "1.0", messageText: "q" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    });
    const getActiveChange: GetSessionTraceDeps["getActiveChange"] = () => ({
      sdkSessionId: "change-uuid-456",
      branch: "fix/test",
      repo: "test-repo",
      description: "test",
      status: "executing",
      startedAt: new Date(),
      lastActivityAt: new Date(),
    });
    const deps = makeDeps({
      getSession,
      getActiveChange,
      readFile: vi.fn(async () => jsonl) as GetSessionTraceDeps["readFile"],
    });

    const result = await callTool(makeCtx(), deps, { sessionId: "test-session", source: "change" });
    const parsed = parseToolResult(result);

    assert.equal(parsed.sdkSessionId, "change-uuid-456");
    assert.equal(parsed.source, "change");
  });

  it("returns error when SDK session file is missing", async () => {
    const getSession: GetSessionTraceDeps["getSession"] = async () => ({
      sessionId: "test-session",
      sdkSessionId: "sdk-uuid-gone",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U1",
      trigger: { type: "mentions" as const, userId: "U1", messageTs: "1.0", messageText: "q" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    });
    const readFile: GetSessionTraceDeps["readFile"] = async () => {
      throw new Error("ENOENT");
    };
    const deps = makeDeps({ getSession, readFile });

    const result = await callTool(makeCtx(), deps, { sessionId: "test-session" });
    const parsed = parseToolResult(result);

    assert.ok(parsed.error.includes("not found"));
  });

  it("includes tool args in verbose mode", async () => {
    const jsonl = makeJsonlContent([
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Grep", input: { pattern: "foo", path: "/bar" } }],
        },
      },
    ]);

    const getSession: GetSessionTraceDeps["getSession"] = async () => ({
      sessionId: "test-session",
      sdkSessionId: "sdk-uuid-v",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U1",
      trigger: { type: "mentions" as const, userId: "U1", messageTs: "1.0", messageText: "q" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    });
    const deps = makeDeps({
      getSession,
      readFile: vi.fn(async () => jsonl) as GetSessionTraceDeps["readFile"],
    });

    const result = await callTool(makeCtx(), deps, { sessionId: "test-session", verbose: true });
    const parsed = parseToolResult(result);

    assert.deepEqual(parsed.trace[0].toolArgs, { pattern: "foo", path: "/bar" });
  });

  it("hints about change trace when QA has no sdkSessionId but change does", async () => {
    const getSession: GetSessionTraceDeps["getSession"] = async () => ({
      sessionId: "test-session",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U1",
      trigger: { type: "mentions" as const, userId: "U1", messageTs: "1.0", messageText: "q" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    });
    const getActiveChange: GetSessionTraceDeps["getActiveChange"] = () => ({
      sdkSessionId: "change-uuid",
      branch: "fix/test",
      repo: "test-repo",
      description: "test",
      status: "executing",
      startedAt: new Date(),
      lastActivityAt: new Date(),
    });
    const deps = makeDeps({ getSession, getActiveChange });

    const result = await callTool(makeCtx(), deps, { sessionId: "test-session" });
    const parsed = parseToolResult(result);

    assert.ok(parsed.error.includes("change execution trace IS available"));
  });
});
