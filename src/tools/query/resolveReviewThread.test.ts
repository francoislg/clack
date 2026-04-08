import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createResolveReviewThreadTool,
  type ResolveReviewThreadDeps,
} from "./resolveReviewThread.js";
import type { QueryToolContext } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    } as never as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function makeDeps(overrides: Partial<ResolveReviewThreadDeps> = {}): ResolveReviewThreadDeps {
  return {
    graphql: mock.fn(async () => ({
      resolveReviewThread: {
        thread: { id: "PRRT_default", isResolved: true },
      },
    })) as ResolveReviewThreadDeps["graphql"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveReviewThread tool", () => {
  it("resolves a thread successfully", async () => {
    const deps = makeDeps({
      graphql: mock.fn(async () => ({
        resolveReviewThread: {
          thread: { id: "PRRT_abc123", isResolved: true },
        },
      })) as ResolveReviewThreadDeps["graphql"],
    });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx, deps);

    const result = await toolDef.handler({ threadId: "PRRT_abc123" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.threadId, "PRRT_abc123");
    assert.equal(parsed.isResolved, true);
    assert.equal(result.isError, undefined);
  });

  it("passes the threadId to the GraphQL mutation", async () => {
    const graphqlMock = mock.fn<ResolveReviewThreadDeps["graphql"]>(async () => ({
      resolveReviewThread: {
        thread: { id: "PRRT_xyz789", isResolved: true },
      },
    }));
    const deps = makeDeps({ graphql: graphqlMock });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx, deps);

    await toolDef.handler({ threadId: "PRRT_xyz789" }, { sessionId: "test" });

    assert.equal(graphqlMock.mock.callCount(), 1);
    const callArgs = graphqlMock.mock.calls[0]!.arguments;
    // First arg is the mutation string, second is the variables
    assert.equal(callArgs[1]!.threadId, "PRRT_xyz789");
  });

  it("returns error when graphql throws", async () => {
    const deps = makeDeps({
      graphql: mock.fn(async () => {
        throw new Error("GitHub App not configured");
      }) as ResolveReviewThreadDeps["graphql"],
    });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx, deps);

    const result = await toolDef.handler({ threadId: "PRRT_abc123" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to resolve review thread"));
    assert.ok(parsed.error.includes("GitHub App not configured"));
    assert.equal(result.isError, true);
  });

  it("returns error when GraphQL mutation fails with insufficient permissions", async () => {
    const deps = makeDeps({
      graphql: mock.fn(async () => {
        throw new Error("Could not resolve thread: insufficient permissions");
      }) as ResolveReviewThreadDeps["graphql"],
    });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx, deps);

    const result = await toolDef.handler({ threadId: "PRRT_invalid" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to resolve review thread"));
    assert.ok(parsed.error.includes("insufficient permissions"));
    assert.equal(result.isError, true);
  });

  it("returns error when non-Error is thrown", async () => {
    const deps = makeDeps({
      graphql: mock.fn(async () => {
        throw "string error";
      }) as ResolveReviewThreadDeps["graphql"],
    });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx, deps);

    const result = await toolDef.handler({ threadId: "PRRT_abc123" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to resolve review thread"));
    assert.equal(result.isError, true);
  });

  it("calls graphql each time for fresh auth", async () => {
    const graphqlMock = mock.fn<ResolveReviewThreadDeps["graphql"]>(async () => ({
      resolveReviewThread: {
        thread: { id: "PRRT_1", isResolved: true },
      },
    }));
    const deps = makeDeps({ graphql: graphqlMock });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx, deps);

    await toolDef.handler({ threadId: "PRRT_1" }, { sessionId: "test" });
    await toolDef.handler({ threadId: "PRRT_2" }, { sessionId: "test" });

    assert.equal(graphqlMock.mock.callCount(), 2);
  });

  it("uses the GraphQL mutation query string", async () => {
    const graphqlMock = mock.fn<ResolveReviewThreadDeps["graphql"]>(async () => ({
      resolveReviewThread: {
        thread: { id: "PRRT_1", isResolved: true },
      },
    }));
    const deps = makeDeps({ graphql: graphqlMock });

    const ctx = makeCtx();
    const toolDef = createResolveReviewThreadTool(ctx, deps);

    await toolDef.handler({ threadId: "PRRT_1" }, { sessionId: "test" });

    const mutationStr = graphqlMock.mock.calls[0]!.arguments[0]!;
    assert.ok(mutationStr.includes("resolveReviewThread"));
    assert.ok(mutationStr.includes("mutation"));
    assert.ok(mutationStr.includes("$threadId"));
  });
});
