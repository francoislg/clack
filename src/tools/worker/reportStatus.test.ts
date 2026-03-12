import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockPostMessage = mock.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetSlackClient = mock.fn<() => unknown>();

mock.module("../../slack/app.js", {
  namedExports: {
    getSlackClient: mockGetSlackClient,
  },
});

mock.module("../../errors.js", {
  namedExports: {
    errorMessage: (err: unknown) =>
      err instanceof Error ? err.message : String(err),
  },
});

// Import after mocks
const { createReportStatusTool } = await import("./reportStatus.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { WorkerToolContext } from "../types.js";

function makeCtx(overrides?: Partial<WorkerToolContext>): WorkerToolContext {
  return {
    mode: "worker",
    worktreePath: "/tmp/worktrees/my-repo/branch",
    branchName: "clack/fix/my-branch",
    repoName: "my-repo",
    repoUrl: "https://github.com/org/my-repo.git",
    channelId: "C123",
    threadTs: "1.0",
    sessionId: "sess-1",
    config: { repositories: [] } as unknown as WorkerToolContext["config"],
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockPostMessage.mock.resetCalls();
  mockGetSlackClient.mock.resetCalls();

  mockGetSlackClient.mock.mockImplementation(() => ({
    chat: { postMessage: mockPostMessage },
  }));
  mockPostMessage.mock.mockImplementation(async () => ({ ok: true }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reportStatus tool", () => {
  beforeEach(resetMocks);

  it("posts message to Slack thread and returns success", async () => {
    const ctx = makeCtx();
    const toolDef = createReportStatusTool(ctx);
    const result = await toolDef.handler(
      { message: "Work is done!" },
      { sessionId: "test" }
    );

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(result.isError, undefined);

    // Verify postMessage was called correctly
    assert.equal(mockPostMessage.mock.callCount(), 1);
    const callArgs = mockPostMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(callArgs.channel, "C123");
    assert.equal(callArgs.thread_ts, "1.0");
    assert.equal(callArgs.text, "Work is done!");
  });

  it("returns error when Slack client is not available", async () => {
    mockGetSlackClient.mock.mockImplementation(() => null);

    const toolDef = createReportStatusTool(makeCtx());
    const result = await toolDef.handler(
      { message: "Status update" },
      { sessionId: "test" }
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Slack client not available"));
    assert.equal(result.isError, true);
  });

  it("returns error when postMessage throws", async () => {
    mockPostMessage.mock.mockImplementation(async () => {
      throw new Error("channel_not_found");
    });

    const toolDef = createReportStatusTool(makeCtx());
    const result = await toolDef.handler(
      { message: "Hello" },
      { sessionId: "test" }
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("slack error"));
    assert.ok(parsed.error.includes("channel_not_found"));
    assert.equal(result.isError, true);
  });

  it("uses channelId and threadTs from context", async () => {
    const ctx = makeCtx({ channelId: "C999", threadTs: "99.99" });
    const toolDef = createReportStatusTool(ctx);
    await toolDef.handler(
      { message: "test" },
      { sessionId: "test" }
    );

    const callArgs = mockPostMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(callArgs.channel, "C999");
    assert.equal(callArgs.thread_ts, "99.99");
  });

  it("passes the message argument as text", async () => {
    const toolDef = createReportStatusTool(makeCtx());
    await toolDef.handler(
      { message: "Build completed successfully with 0 errors" },
      { sessionId: "test" }
    );

    const callArgs = mockPostMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(callArgs.text, "Build completed successfully with 0 errors");
  });
});
