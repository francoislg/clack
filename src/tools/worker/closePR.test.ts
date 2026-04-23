import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createClosePRTool, type ClosePRDeps } from "./closePR.js";
import type { WorkerToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";

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

function makeDeps() {
  const mockGetSession = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    activeChange: { prUrl: "https://github.com/org/my-repo/pull/42" },
  }));
  const mockGetOctokit = mock.fn<() => Promise<unknown>>(async () => ({
    pulls: { update: mock.fn(async () => ({})) },
    git: { deleteRef: mock.fn(async () => ({})) },
  }));
  const mockParsePrUrl = mock.fn<(url: string) => unknown>(() => ({
    owner: "org",
    repo: "my-repo",
    pullNumber: 42,
  }));
  const mockAppendExecutionLog = mock.fn<(...args: unknown[]) => void>();
  const mockCleanupAfterPRAction = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});

  const deps: ClosePRDeps = {
    getSession: mockGetSession as never as ClosePRDeps["getSession"],
    getOctokit: mockGetOctokit as never as ClosePRDeps["getOctokit"],
    parsePrUrl: mockParsePrUrl as never as ClosePRDeps["parsePrUrl"],
    appendExecutionLog: mockAppendExecutionLog as never as ClosePRDeps["appendExecutionLog"],
    cleanupAfterPRAction: mockCleanupAfterPRAction as never as ClosePRDeps["cleanupAfterPRAction"],
  };

  return {
    deps,
    mockGetSession,
    mockGetOctokit,
    mockParsePrUrl,
    mockAppendExecutionLog,
    mockCleanupAfterPRAction,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("closePR tool", () => {
  it("returns error when no session found", async () => {
    const { deps, mockGetSession } = makeDeps();
    mockGetSession.mock.mockImplementation(async () => null);

    const toolDef = createClosePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("No active change"));
    assert.equal(result.isError, true);
  });

  it("returns error when session has no activeChange", async () => {
    const { deps, mockGetSession } = makeDeps();
    mockGetSession.mock.mockImplementation(async () => ({ activeChange: null }));

    const toolDef = createClosePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("No active change"));
    assert.equal(result.isError, true);
  });

  it("returns error when activeChange has no prUrl", async () => {
    const { deps, mockGetSession } = makeDeps();
    mockGetSession.mock.mockImplementation(async () => ({
      activeChange: { prUrl: undefined },
    }));

    const toolDef = createClosePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("No PR URL"));
    assert.equal(result.isError, true);
  });

  it("returns error when PR URL cannot be parsed", async () => {
    const { deps, mockParsePrUrl } = makeDeps();
    mockParsePrUrl.mock.mockImplementation(() => null);

    const toolDef = createClosePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("Could not parse PR URL"));
    assert.equal(result.isError, true);
  });

  it("closes PR and returns success without branch deletion", async () => {
    const mockUpdate = mock.fn(async () => ({}));
    const { deps, mockGetOctokit, mockCleanupAfterPRAction } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { update: mockUpdate },
      git: { deleteRef: mock.fn() },
    }));

    const toolDef = createClosePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.branch_deleted, false);
    assert.equal(parsed.warning, undefined);

    // Verify PR was closed
    assert.equal(mockUpdate.mock.callCount(), 1);
    const callArgs = mockUpdate.mock.calls[0]!.arguments as never as [
      { owner: string; repo: string; pull_number: number; state: string },
    ];
    assert.equal(callArgs[0].owner, "org");
    assert.equal(callArgs[0].repo, "my-repo");
    assert.equal(callArgs[0].pull_number, 42);
    assert.equal(callArgs[0].state, "closed");

    // Verify cleanup was called
    assert.equal(mockCleanupAfterPRAction.mock.callCount(), 1);
  });

  it("closes PR and deletes remote branch when delete_branch is true", async () => {
    const mockUpdate = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => ({}));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { update: mockUpdate },
      git: { deleteRef: mockDeleteRef },
    }));

    const ctx = makeCtx();
    const toolDef = createClosePRTool(ctx, deps);
    const result = await toolDef.handler({ delete_branch: true }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.branch_deleted, true);

    // Verify branch deletion was called
    assert.equal(mockDeleteRef.mock.callCount(), 1);
    const deleteArgs = mockDeleteRef.mock.calls[0]!.arguments as never as [
      { owner: string; repo: string; ref: string },
    ];
    assert.equal(deleteArgs[0].owner, "org");
    assert.equal(deleteArgs[0].repo, "my-repo");
    assert.equal(deleteArgs[0].ref, `heads/${ctx.branchName}`);
  });

  it("returns warning when branch deletion fails", async () => {
    const mockUpdate = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => {
      throw new Error("ref not found");
    });
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { update: mockUpdate },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createClosePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ delete_branch: true }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.branch_deleted, false);
    assert.ok(parsed.warning);
    assert.ok(parsed.warning.includes("ref not found"));
  });

  it("returns error when pulls.update throws", async () => {
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: {
        update: mock.fn(async () => {
          throw new Error("API error");
        }),
      },
    }));

    const toolDef = createClosePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to close PR"));
    assert.ok(parsed.error.includes("API error"));
    assert.equal(result.isError, true);
  });

  it("logs execution when PR is closed", async () => {
    const { deps, mockGetOctokit, mockAppendExecutionLog } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { update: mock.fn(async () => ({})) },
    }));

    const ctx = makeCtx();
    const toolDef = createClosePRTool(ctx, deps);
    await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    assert.ok(mockAppendExecutionLog.mock.callCount() >= 1);
    const firstCallArgs = mockAppendExecutionLog.mock.calls[0]!.arguments as [string, string];
    assert.equal(firstCallArgs[0], ctx.branchName);
    assert.ok(firstCallArgs[1].includes("close_pr"));
  });
});
