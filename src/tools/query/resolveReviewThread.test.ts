import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetOctokit = mock.fn<() => Promise<unknown>>();

mock.module("../../github.js", {
  namedExports: {
    getOctokit: mockGetOctokit,
  },
});

mock.module("../../logger.js", {
  namedExports: {
    logger: {
      debug: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
    },
  },
});

// Import after mocks
const { createResolveReviewThreadTool } = await import("./resolveReviewThread.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";

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
    } as unknown as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

const mockGraphql = mock.fn<(...args: unknown[]) => Promise<unknown>>();

function resetMocks() {
  mockGetOctokit.mock.resetCalls();
  mockGraphql.mock.resetCalls();

  mockGetOctokit.mock.mockImplementation(async () => ({
    graphql: mockGraphql,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveReviewThread tool", () => {
  beforeEach(resetMocks);

  it("resolves a thread successfully", async () => {
    mockGraphql.mock.mockImplementation(async () => ({
      resolveReviewThread: {
        thread: { id: "PRRT_abc123", isResolved: true },
      },
    }));

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx);

    const result = await toolDef.handler({ threadId: "PRRT_abc123" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.threadId, "PRRT_abc123");
    assert.equal(parsed.isResolved, true);
    assert.equal(result.isError, undefined);
  });

  it("passes the threadId to the GraphQL mutation", async () => {
    mockGraphql.mock.mockImplementation(async () => ({
      resolveReviewThread: {
        thread: { id: "PRRT_xyz789", isResolved: true },
      },
    }));

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx);

    await toolDef.handler({ threadId: "PRRT_xyz789" }, { sessionId: "test" });

    assert.equal(mockGraphql.mock.callCount(), 1);
    const callArgs = mockGraphql.mock.calls[0].arguments;
    // First arg is the mutation string, second is the variables
    assert.equal((callArgs[1] as { threadId: string }).threadId, "PRRT_xyz789");
  });

  it("returns error when getOctokit fails", async () => {
    mockGetOctokit.mock.mockImplementation(async () => {
      throw new Error("GitHub App not configured");
    });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx);

    const result = await toolDef.handler({ threadId: "PRRT_abc123" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to resolve review thread"));
    assert.ok(parsed.error.includes("GitHub App not configured"));
    assert.equal(result.isError, true);
  });

  it("returns error when GraphQL mutation fails", async () => {
    mockGraphql.mock.mockImplementation(async () => {
      throw new Error("Could not resolve thread: insufficient permissions");
    });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx);

    const result = await toolDef.handler({ threadId: "PRRT_invalid" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to resolve review thread"));
    assert.ok(parsed.error.includes("insufficient permissions"));
    assert.equal(result.isError, true);
  });

  it("returns error when non-Error is thrown", async () => {
    mockGraphql.mock.mockImplementation(async () => {
      throw "string error";
    });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx);

    const result = await toolDef.handler({ threadId: "PRRT_abc123" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to resolve review thread"));
    assert.equal(result.isError, true);
  });

  it("calls getOctokit each time to get fresh auth", async () => {
    mockGraphql.mock.mockImplementation(async () => ({
      resolveReviewThread: {
        thread: { id: "PRRT_1", isResolved: true },
      },
    }));

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx);

    await toolDef.handler({ threadId: "PRRT_1" }, { sessionId: "test" });
    await toolDef.handler({ threadId: "PRRT_2" }, { sessionId: "test" });

    assert.equal(mockGetOctokit.mock.callCount(), 2);
  });

  it("uses the GraphQL mutation query string", async () => {
    mockGraphql.mock.mockImplementation(async () => ({
      resolveReviewThread: {
        thread: { id: "PRRT_1", isResolved: true },
      },
    }));

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx);

    await toolDef.handler({ threadId: "PRRT_1" }, { sessionId: "test" });

    const mutationStr = mockGraphql.mock.calls[0].arguments[0] as string;
    assert.ok(mutationStr.includes("resolveReviewThread"));
    assert.ok(mutationStr.includes("mutation"));
    assert.ok(mutationStr.includes("$threadId"));
  });
});
