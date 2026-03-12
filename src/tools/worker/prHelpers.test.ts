import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockUpdateActiveChangeStatus = mock.fn<(...args: unknown[]) => void>();
const mockClearActiveChange = mock.fn<(...args: unknown[]) => void>();
mock.module("../../changes/activeState.js", {
  namedExports: {
    updateActiveChangeStatus: mockUpdateActiveChangeStatus,
    clearActiveChange: mockClearActiveChange,
  },
});

const mockAppendExecutionLog = mock.fn<(...args: unknown[]) => void>();
mock.module("../../changes/persistence.js", {
  namedExports: { appendExecutionLog: mockAppendExecutionLog },
});

const mockRemoveWorktree = mock.fn<(...args: unknown[]) => Promise<void>>();
const mockDeleteBranch = mock.fn<(...args: unknown[]) => Promise<void>>();
mock.module("../../worktrees.js", {
  namedExports: {
    removeWorktree: mockRemoveWorktree,
    deleteBranch: mockDeleteBranch,
  },
});

// Import after mocks
const { cleanupAfterPRAction } = await import("./prHelpers.js");

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

function resetMocks() {
  mockUpdateActiveChangeStatus.mock.resetCalls();
  mockClearActiveChange.mock.resetCalls();
  mockAppendExecutionLog.mock.resetCalls();
  mockRemoveWorktree.mock.resetCalls();
  mockDeleteBranch.mock.resetCalls();

  mockRemoveWorktree.mock.mockImplementation(async () => {});
  mockDeleteBranch.mock.mockImplementation(async () => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanupAfterPRAction", () => {
  beforeEach(resetMocks);

  it("calls all cleanup steps in order", async () => {
    const ctx = makeCtx();
    await cleanupAfterPRAction(ctx, "test_prefix");

    // updateActiveChangeStatus called with sessionId and "completed"
    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 1);
    const statusArgs = mockUpdateActiveChangeStatus.mock.calls[0].arguments as [string, string];
    assert.equal(statusArgs[0], "sess-1");
    assert.equal(statusArgs[1], "completed");

    // removeWorktree called with repoName and worktreePath
    assert.equal(mockRemoveWorktree.mock.callCount(), 1);
    const removeArgs = mockRemoveWorktree.mock.calls[0].arguments as [string, string];
    assert.equal(removeArgs[0], "my-repo");
    assert.equal(removeArgs[1], "/tmp/worktrees/my-repo/branch");

    // deleteBranch called with repoName and branchName
    assert.equal(mockDeleteBranch.mock.callCount(), 1);
    const deleteArgs = mockDeleteBranch.mock.calls[0].arguments as [string, string];
    assert.equal(deleteArgs[0], "my-repo");
    assert.equal(deleteArgs[1], "clack/fix/my-branch");

    // clearActiveChange called with sessionId and true
    assert.equal(mockClearActiveChange.mock.callCount(), 1);
    const clearArgs = mockClearActiveChange.mock.calls[0].arguments as [string, boolean];
    assert.equal(clearArgs[0], "sess-1");
    assert.equal(clearArgs[1], true);

    // appendExecutionLog called with branchName and log message
    assert.equal(mockAppendExecutionLog.mock.callCount(), 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0].arguments as [string, string];
    assert.equal(logArgs[0], "clack/fix/my-branch");
    assert.ok(logArgs[1].includes("test_prefix"));
    assert.ok(logArgs[1].includes("cleanup complete"));
  });

  it("uses the provided logPrefix in the log message", async () => {
    await cleanupAfterPRAction(makeCtx(), "close_pr");

    const logArgs = mockAppendExecutionLog.mock.calls[0].arguments as [string, string];
    assert.ok(logArgs[1].startsWith("close_pr:"));
  });

  it("uses context values correctly for different contexts", async () => {
    const ctx = makeCtx({
      sessionId: "other-session",
      repoName: "other-repo",
      worktreePath: "/tmp/worktrees/other-repo/other-branch",
      branchName: "clack/feat/other",
    });

    await cleanupAfterPRAction(ctx, "merge_pr");

    const statusArgs = mockUpdateActiveChangeStatus.mock.calls[0].arguments as [string, string];
    assert.equal(statusArgs[0], "other-session");

    const removeArgs = mockRemoveWorktree.mock.calls[0].arguments as [string, string];
    assert.equal(removeArgs[0], "other-repo");
    assert.equal(removeArgs[1], "/tmp/worktrees/other-repo/other-branch");

    const deleteArgs = mockDeleteBranch.mock.calls[0].arguments as [string, string];
    assert.equal(deleteArgs[0], "other-repo");
    assert.equal(deleteArgs[1], "clack/feat/other");

    const clearArgs = mockClearActiveChange.mock.calls[0].arguments as [string, boolean];
    assert.equal(clearArgs[0], "other-session");
  });
});
