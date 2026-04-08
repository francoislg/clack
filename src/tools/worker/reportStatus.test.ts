import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createReportStatusTool, type ReportStatusDeps } from "./reportStatus.js";
import type { WorkerToolContext } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    config: { repositories: [] } as never as WorkerToolContext["config"],
    ...overrides,
  };
}

interface ToolResult {
  content: Array<{ text: string }>;
  isError?: true;
}

function parseResult(result: ToolResult) {
  return JSON.parse(result.content[0]!.text);
}

function makeDeps() {
  const mockPostMessage = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    ok: true,
  }));
  const mockGetSlackClient = mock.fn<() => unknown>(() => ({
    chat: { postMessage: mockPostMessage },
  }));

  const deps: ReportStatusDeps = {
    getSlackClient: mockGetSlackClient as never as ReportStatusDeps["getSlackClient"],
  };

  return { deps, mockGetSlackClient, mockPostMessage };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reportStatus tool", () => {
  it("posts message to Slack thread and returns success", async () => {
    const { deps, mockPostMessage } = makeDeps();

    const ctx = makeCtx();
    const toolDef = createReportStatusTool(ctx, deps);
    const result = await toolDef.handler({ message: "Work is done!" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(result.isError, undefined);

    // Verify postMessage was called correctly
    assert.equal(mockPostMessage.mock.callCount(), 1);
    const callArgs = mockPostMessage.mock.calls[0]!.arguments[0] as {
      channel: string;
      thread_ts: string;
      text: string;
    };
    assert.equal(callArgs.channel, "C123");
    assert.equal(callArgs.thread_ts, "1.0");
    assert.equal(callArgs.text, "Work is done!");
  });

  it("returns error when Slack client is not available", async () => {
    const { deps, mockGetSlackClient } = makeDeps();
    mockGetSlackClient.mock.mockImplementation(() => null);

    const toolDef = createReportStatusTool(makeCtx(), deps);
    const result = await toolDef.handler({ message: "Status update" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Slack client not available"));
    assert.equal(result.isError, true);
  });

  it("returns error when postMessage throws", async () => {
    const { deps, mockPostMessage } = makeDeps();
    mockPostMessage.mock.mockImplementation(async () => {
      throw new Error("channel_not_found");
    });

    const toolDef = createReportStatusTool(makeCtx(), deps);
    const result = await toolDef.handler({ message: "Hello" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("slack error"));
    assert.ok(parsed.error.includes("channel_not_found"));
    assert.equal(result.isError, true);
  });

  it("uses channelId and threadTs from context", async () => {
    const { deps, mockPostMessage } = makeDeps();

    const ctx = makeCtx({ channelId: "C999", threadTs: "99.99" });
    const toolDef = createReportStatusTool(ctx, deps);
    await toolDef.handler({ message: "test" }, { sessionId: "test" });

    const callArgs = mockPostMessage.mock.calls[0]!.arguments[0] as {
      channel: string;
      thread_ts: string;
    };
    assert.equal(callArgs.channel, "C999");
    assert.equal(callArgs.thread_ts, "99.99");
  });

  it("passes the message argument as text", async () => {
    const { deps, mockPostMessage } = makeDeps();

    const toolDef = createReportStatusTool(makeCtx(), deps);
    await toolDef.handler(
      { message: "Build completed successfully with 0 errors" },
      { sessionId: "test" },
    );

    const callArgs = mockPostMessage.mock.calls[0]!.arguments[0] as { text: string };
    assert.equal(callArgs.text, "Build completed successfully with 0 errors");
  });
});
