import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as realFs from "node:fs/promises";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetSession = mock.fn<(...args: unknown[]) => unknown>();
const mockGetActiveChange = mock.fn<(...args: unknown[]) => unknown>();
const mockReadFile = mock.fn<(...args: unknown[]) => unknown>();

mock.module("../../sessions.js", {
  namedExports: {
    getSession: mockGetSession,
  },
});

mock.module("../../changes/activeState.js", {
  namedExports: {
    getActiveChange: mockGetActiveChange,
  },
});

// Spread real fs/promises and override only readFile
mock.module("node:fs/promises", {
  namedExports: {
    ...realFs,
    readFile: mockReadFile,
  },
});

mock.module("../../config.js", {
  namedExports: {
    getRepositoriesDir: () => "/repos",
  },
});

// Import after mocks
const { createGetSessionTraceTool } = await import("./getSessionTrace.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";

function makeCtx(): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "admin",
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
    config: { repositories: [] } as unknown as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function makeJsonlContent(entries: Record<string, unknown>[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("get_session_trace", () => {
  beforeEach(() => {
    mockGetSession.mock.resetCalls();
    mockGetActiveChange.mock.resetCalls();
    mockReadFile.mock.resetCalls();
  });

  it("returns error when session not found", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const toolDef = createGetSessionTraceTool(makeCtx());
    const result = await toolDef.handler({ sessionId: "nonexistent", verbose: undefined, source: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("not found"));
  });

  it("returns error when no sdkSessionId on session", async () => {
    mockGetSession.mock.mockImplementation(async () => ({
      sessionId: "test-session",
    }));
    mockGetActiveChange.mock.mockImplementation(() => undefined);

    const toolDef = createGetSessionTraceTool(makeCtx());
    const result = await toolDef.handler({ sessionId: "test-session", verbose: undefined, source: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("No SDK session ID"));
  });

  it("returns trace for session with sdkSessionId", async () => {
    mockGetSession.mock.mockImplementation(async () => ({
      sessionId: "test-session",
      sdkSessionId: "sdk-uuid-123",
    }));
    mockGetActiveChange.mock.mockImplementation(() => undefined);

    const jsonl = makeJsonlContent([
      { type: "user", message: { content: "hello" }, timestamp: "2026-01-01T00:00:00Z" },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/foo.ts" } }] },
        timestamp: "2026-01-01T00:00:01Z",
      },
      { type: "result", subtype: "success", result: "done", timestamp: "2026-01-01T00:00:02Z" },
    ]);
    mockReadFile.mock.mockImplementation(async () => jsonl);

    const toolDef = createGetSessionTraceTool(makeCtx());
    const result = await toolDef.handler({ sessionId: "test-session", verbose: undefined, source: undefined }, { sessionId: "test" });
    const parsed = parseResult(result);

    assert.equal(parsed.sdkSessionId, "sdk-uuid-123");
    assert.equal(parsed.totalMessages, 3);
    assert.equal(parsed.trace[1].toolName, "Read");
  });

  it("returns change execution trace when source is 'change'", async () => {
    mockGetSession.mock.mockImplementation(async () => ({
      sessionId: "test-session",
      sdkSessionId: "qa-uuid",
    }));
    mockGetActiveChange.mock.mockImplementation(() => ({
      sdkSessionId: "change-uuid-456",
      branch: "fix/test",
    }));

    const jsonl = makeJsonlContent([
      { type: "assistant", message: { content: [{ type: "text", text: "implementing..." }] } },
    ]);
    mockReadFile.mock.mockImplementation(async () => jsonl);

    const toolDef = createGetSessionTraceTool(makeCtx());
    const result = await toolDef.handler({ sessionId: "test-session", verbose: undefined, source: "change" }, { sessionId: "test" });
    const parsed = parseResult(result);

    assert.equal(parsed.sdkSessionId, "change-uuid-456");
    assert.equal(parsed.source, "change");
  });

  it("returns error when SDK session file is missing", async () => {
    mockGetSession.mock.mockImplementation(async () => ({
      sessionId: "test-session",
      sdkSessionId: "sdk-uuid-gone",
    }));
    mockGetActiveChange.mock.mockImplementation(() => undefined);
    mockReadFile.mock.mockImplementation(async () => {
      throw new Error("ENOENT");
    });

    const toolDef = createGetSessionTraceTool(makeCtx());
    const result = await toolDef.handler({ sessionId: "test-session", verbose: undefined, source: undefined }, { sessionId: "test" });
    const parsed = parseResult(result);

    assert.ok(parsed.error.includes("not found"));
  });

  it("includes tool args in verbose mode", async () => {
    mockGetSession.mock.mockImplementation(async () => ({
      sessionId: "test-session",
      sdkSessionId: "sdk-uuid-v",
    }));
    mockGetActiveChange.mock.mockImplementation(() => undefined);

    const jsonl = makeJsonlContent([
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "foo", path: "/bar" } }] },
      },
    ]);
    mockReadFile.mock.mockImplementation(async () => jsonl);

    const toolDef = createGetSessionTraceTool(makeCtx());
    const result = await toolDef.handler({ sessionId: "test-session", verbose: true, source: undefined }, { sessionId: "test" });
    const parsed = parseResult(result);

    assert.deepEqual(parsed.trace[0].toolArgs, { pattern: "foo", path: "/bar" });
  });

  it("hints about change trace when QA has no sdkSessionId but change does", async () => {
    mockGetSession.mock.mockImplementation(async () => ({
      sessionId: "test-session",
    }));
    mockGetActiveChange.mock.mockImplementation(() => ({
      sdkSessionId: "change-uuid",
      branch: "fix/test",
    }));

    const toolDef = createGetSessionTraceTool(makeCtx());
    const result = await toolDef.handler({ sessionId: "test-session", verbose: undefined, source: undefined }, { sessionId: "test" });
    const parsed = parseResult(result);

    assert.ok(parsed.error.includes("change execution trace IS available"));
  });
});
