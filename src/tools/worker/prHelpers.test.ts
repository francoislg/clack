import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanupAfterPRAction, type CleanupAfterPRActionDeps } from "./prHelpers.js";
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

function makeDeps() {
  const mockUpdateActiveChangeStatus = vi.fn<(...args: unknown[]) => void>();
  const mockClearActiveChange = vi.fn<(...args: unknown[]) => void>();
  const mockAppendExecutionLog = vi.fn<(...args: unknown[]) => void>();
  const mockRemoveWorktree = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
  const mockDeleteBranch = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

  const deps: CleanupAfterPRActionDeps = {
    updateActiveChangeStatus:
      mockUpdateActiveChangeStatus as never as CleanupAfterPRActionDeps["updateActiveChangeStatus"],
    clearActiveChange:
      mockClearActiveChange as never as CleanupAfterPRActionDeps["clearActiveChange"],
    appendExecutionLog:
      mockAppendExecutionLog as never as CleanupAfterPRActionDeps["appendExecutionLog"],
    removeWorktree: mockRemoveWorktree as never as CleanupAfterPRActionDeps["removeWorktree"],
    deleteBranch: mockDeleteBranch as never as CleanupAfterPRActionDeps["deleteBranch"],
  };

  return {
    deps,
    mockUpdateActiveChangeStatus,
    mockClearActiveChange,
    mockAppendExecutionLog,
    mockRemoveWorktree,
    mockDeleteBranch,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanupAfterPRAction", () => {
  it("calls all cleanup steps in order", async () => {
    const {
      deps,
      mockUpdateActiveChangeStatus,
      mockClearActiveChange,
      mockAppendExecutionLog,
      mockRemoveWorktree,
      mockDeleteBranch,
    } = makeDeps();

    const ctx = makeCtx();
    await cleanupAfterPRAction(ctx, "test_prefix", deps);

    // updateActiveChangeStatus called with sessionId and "completed"
    assert.equal(mockUpdateActiveChangeStatus.mock.calls.length, 1);
    const statusArgs = mockUpdateActiveChangeStatus.mock.calls[0]! as [string, string];
    assert.equal(statusArgs[0], "sess-1");
    assert.equal(statusArgs[1], "completed");

    // removeWorktree called with repoName and worktreePath
    assert.equal(mockRemoveWorktree.mock.calls.length, 1);
    const removeArgs = mockRemoveWorktree.mock.calls[0]! as [string, string];
    assert.equal(removeArgs[0], "my-repo");
    assert.equal(removeArgs[1], "/tmp/worktrees/my-repo/branch");

    // deleteBranch called with repoName and branchName
    assert.equal(mockDeleteBranch.mock.calls.length, 1);
    const deleteArgs = mockDeleteBranch.mock.calls[0]! as [string, string];
    assert.equal(deleteArgs[0], "my-repo");
    assert.equal(deleteArgs[1], "clack/fix/my-branch");

    // clearActiveChange called with sessionId and true
    assert.equal(mockClearActiveChange.mock.calls.length, 1);
    const clearArgs = mockClearActiveChange.mock.calls[0]! as [string, boolean];
    assert.equal(clearArgs[0], "sess-1");
    assert.equal(clearArgs[1], true);

    // appendExecutionLog called with branchName and log message
    assert.equal(mockAppendExecutionLog.mock.calls.length, 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0]! as [string, string];
    assert.equal(logArgs[0], "clack/fix/my-branch");
    assert.ok(logArgs[1].includes("test_prefix"));
    assert.ok(logArgs[1].includes("cleanup complete"));
  });

  it("uses the provided logPrefix in the log message", async () => {
    const { deps, mockAppendExecutionLog } = makeDeps();
    await cleanupAfterPRAction(makeCtx(), "close_pr", deps);

    const logArgs = mockAppendExecutionLog.mock.calls[0]! as [string, string];
    assert.ok(logArgs[1].startsWith("close_pr:"));
  });

  it("uses context values correctly for different contexts", async () => {
    const {
      deps,
      mockUpdateActiveChangeStatus,
      mockClearActiveChange,
      mockRemoveWorktree,
      mockDeleteBranch,
    } = makeDeps();

    const ctx = makeCtx({
      sessionId: "other-session",
      repoName: "other-repo",
      worktreePath: "/tmp/worktrees/other-repo/other-branch",
      branchName: "clack/feat/other",
    });

    await cleanupAfterPRAction(ctx, "merge_pr", deps);

    const statusArgs = mockUpdateActiveChangeStatus.mock.calls[0]! as [string, string];
    assert.equal(statusArgs[0], "other-session");

    const removeArgs = mockRemoveWorktree.mock.calls[0]! as [string, string];
    assert.equal(removeArgs[0], "other-repo");
    assert.equal(removeArgs[1], "/tmp/worktrees/other-repo/other-branch");

    const deleteArgs = mockDeleteBranch.mock.calls[0]! as [string, string];
    assert.equal(deleteArgs[0], "other-repo");
    assert.equal(deleteArgs[1], "clack/feat/other");

    const clearArgs = mockClearActiveChange.mock.calls[0]! as [string, boolean];
    assert.equal(clearArgs[0], "other-session");
  });
});
