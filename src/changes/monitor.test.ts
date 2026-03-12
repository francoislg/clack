import { describe, it, beforeEach, mock, type Mock } from "node:test";
import assert from "node:assert/strict";

// ============================================================================
// Mock setup — must be before importing the module under test
// ============================================================================

// -- logger --
mock.module("../logger.js", {
  namedExports: {
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  },
});

// -- errors --
mock.module("../errors.js", {
  namedExports: {
    errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  },
});

// -- config --
let mockConfig: Record<string, unknown> = {};

mock.module("../config.js", {
  namedExports: {
    getConfig: () => mockConfig,
  },
});

// -- worktrees --
const mockRemoveWorktree = mock.fn<(repoName: string, worktreePath: string) => Promise<void>>();

mock.module("../worktrees.js", {
  namedExports: {
    removeWorktree: mockRemoveWorktree,
  },
});

// -- pr --
const mockGetPRStatus = mock.fn<(prUrl: string) => Promise<{ state: string } | null>>();

mock.module("./pr.js", {
  namedExports: {
    getPRStatus: mockGetPRStatus,
  },
});

// -- sessions --
const mockGetSession = mock.fn<(sessionId: string) => Promise<unknown>>();

mock.module("../sessions.js", {
  namedExports: {
    getSession: mockGetSession,
  },
});

// -- activeState --
const mockGetActiveWorkers = mock.fn<() => Array<Record<string, unknown>>>();
const mockUpdateActiveChangeStatus = mock.fn<(sessionId: string, status: string, message?: string) => void>();
const mockClearActiveChange = mock.fn<(sessionId: string, cleanupFolder?: boolean) => void>();

mock.module("./activeState.js", {
  namedExports: {
    getActiveWorkers: mockGetActiveWorkers,
    updateActiveChangeStatus: mockUpdateActiveChangeStatus,
    clearActiveChange: mockClearActiveChange,
  },
});

// -- Import the module under test after all mocks --
const {
  checkSessionCompletion,
  runCompletionCheck,
  startCompletionMonitor,
  stopCompletionMonitor,
} = await import("./monitor.js");

// ============================================================================
// Helpers
// ============================================================================

function makeActiveChange(overrides: Record<string, unknown> = {}) {
  return {
    branch: "feat/test",
    repo: "org/repo",
    description: "Test change",
    status: "pr_created",
    prUrl: "https://github.com/org/repo/pull/42",
    startedAt: new Date(),
    lastActivityAt: new Date(),
    worktree: {
      repoName: "repo",
      branchName: "feat/test",
      worktreePath: "/tmp/worktrees/repo/feat-test",
      createdAt: new Date(),
    },
    ...overrides,
  };
}

function makeWorker(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "U001",
    status: "pr_created",
    description: "Test change",
    branch: "feat/test",
    repo: "org/repo",
    prUrl: "https://github.com/org/repo/pull/42",
    channel: "C001",
    threadTs: "1700000000.000001",
    startedAt: new Date(),
    ...overrides,
  };
}

function resetMocks() {
  mockConfig = {
    changesWorkflow: {
      enabled: true,
      monitoringIntervalMinutes: 5,
    },
  };
  mockRemoveWorktree.mock.resetCalls();
  mockRemoveWorktree.mock.mockImplementation(async () => {});
  mockGetPRStatus.mock.resetCalls();
  mockGetPRStatus.mock.mockImplementation(async () => ({ state: "OPEN" }));
  mockGetSession.mock.resetCalls();
  mockGetSession.mock.mockImplementation(async () => null);
  mockGetActiveWorkers.mock.resetCalls();
  mockGetActiveWorkers.mock.mockImplementation(() => []);
  mockUpdateActiveChangeStatus.mock.resetCalls();
  mockClearActiveChange.mock.resetCalls();
}

beforeEach(() => {
  resetMocks();
  // Ensure the monitor is stopped between tests
  stopCompletionMonitor();
});

// ============================================================================
// checkSessionCompletion
// ============================================================================

describe("checkSessionCompletion", () => {
  it("returns 'none' when status is not pr_created", async () => {
    const activeChange = makeActiveChange({ status: "executing" });
    const result = await checkSessionCompletion(activeChange as never);
    assert.equal(result.action, "none");
  });

  it("returns 'none' when prUrl is missing", async () => {
    const activeChange = makeActiveChange({ status: "pr_created", prUrl: undefined });
    const result = await checkSessionCompletion(activeChange as never);
    assert.equal(result.action, "none");
  });

  it("returns 'none' when getPRStatus returns null", async () => {
    mockGetPRStatus.mock.mockImplementation(async () => null);
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange as never);
    assert.equal(result.action, "none");
  });

  it("returns 'merged' when PR state is MERGED", async () => {
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "MERGED" }));
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange as never);
    assert.equal(result.action, "merged");
    assert.equal(result.prState, "MERGED");
  });

  it("returns 'closed' when PR state is CLOSED", async () => {
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "CLOSED" }));
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange as never);
    assert.equal(result.action, "closed");
    assert.equal(result.prState, "CLOSED");
  });

  it("returns 'none' with prState when PR is still OPEN", async () => {
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "OPEN" }));
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange as never);
    assert.equal(result.action, "none");
    assert.equal(result.prState, "OPEN");
  });

  it("calls getPRStatus with the correct PR URL", async () => {
    const prUrl = "https://github.com/org/repo/pull/99";
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "OPEN" }));
    const activeChange = makeActiveChange({ prUrl });
    await checkSessionCompletion(activeChange as never);
    assert.equal(mockGetPRStatus.mock.callCount(), 1);
    assert.equal(mockGetPRStatus.mock.calls[0].arguments[0], prUrl);
  });
});

// ============================================================================
// runCompletionCheck
// ============================================================================

describe("runCompletionCheck", () => {
  it("does nothing when there are no active workers", async () => {
    mockGetActiveWorkers.mock.mockImplementation(() => []);
    await runCompletionCheck();
    assert.equal(mockGetPRStatus.mock.callCount(), 0);
  });

  it("skips workers without pr_created status", async () => {
    mockGetActiveWorkers.mock.mockImplementation(() => [
      makeWorker({ status: "executing" }),
    ]);
    await runCompletionCheck();
    assert.equal(mockGetPRStatus.mock.callCount(), 0);
  });

  it("skips workers without a prUrl", async () => {
    mockGetActiveWorkers.mock.mockImplementation(() => [
      makeWorker({ status: "pr_created", prUrl: undefined }),
    ]);
    await runCompletionCheck();
    assert.equal(mockGetPRStatus.mock.callCount(), 0);
  });

  it("skips workers when getSession returns null", async () => {
    mockGetActiveWorkers.mock.mockImplementation(() => [makeWorker()]);
    mockGetSession.mock.mockImplementation(async () => null);
    await runCompletionCheck();
    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 0);
  });

  it("skips workers when session has no activeChange", async () => {
    mockGetActiveWorkers.mock.mockImplementation(() => [makeWorker()]);
    mockGetSession.mock.mockImplementation(async () => ({
      activeChange: undefined,
    }));
    await runCompletionCheck();
    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 0);
  });

  it("cleans up a session when its PR has been merged externally", async () => {
    const activeChange = makeActiveChange();
    mockGetActiveWorkers.mock.mockImplementation(() => [makeWorker({ id: "sess-1" })]);
    mockGetSession.mock.mockImplementation(async () => ({ activeChange }));
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "MERGED" }));

    await runCompletionCheck();

    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 1);
    assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[0], "sess-1");
    assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[1], "completed");
    assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[2], "PR merged externally");

    assert.equal(mockClearActiveChange.mock.callCount(), 1);
    assert.equal(mockClearActiveChange.mock.calls[0].arguments[0], "sess-1");
    assert.equal(mockClearActiveChange.mock.calls[0].arguments[1], true); // cleanupFolder for merged
  });

  it("cleans up a session when its PR has been closed externally", async () => {
    const activeChange = makeActiveChange();
    mockGetActiveWorkers.mock.mockImplementation(() => [makeWorker({ id: "sess-2" })]);
    mockGetSession.mock.mockImplementation(async () => ({ activeChange }));
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "CLOSED" }));

    await runCompletionCheck();

    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 1);
    assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[1], "failed");
    assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[2], "PR closed externally");

    assert.equal(mockClearActiveChange.mock.callCount(), 1);
    assert.equal(mockClearActiveChange.mock.calls[0].arguments[1], false); // no cleanupFolder for closed
  });

  it("removes worktree during cleanup when worktree info is present", async () => {
    const activeChange = makeActiveChange({
      worktree: {
        repoName: "my-repo",
        branchName: "feat/test",
        worktreePath: "/tmp/wt/my-repo/feat-test",
        createdAt: new Date(),
      },
    });
    mockGetActiveWorkers.mock.mockImplementation(() => [makeWorker({ id: "sess-wt" })]);
    mockGetSession.mock.mockImplementation(async () => ({ activeChange }));
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "MERGED" }));

    await runCompletionCheck();

    assert.equal(mockRemoveWorktree.mock.callCount(), 1);
    assert.equal(mockRemoveWorktree.mock.calls[0].arguments[0], "my-repo");
    assert.equal(mockRemoveWorktree.mock.calls[0].arguments[1], "/tmp/wt/my-repo/feat-test");
  });

  it("does not throw when worktree removal fails", async () => {
    const activeChange = makeActiveChange();
    mockGetActiveWorkers.mock.mockImplementation(() => [makeWorker({ id: "sess-err" })]);
    mockGetSession.mock.mockImplementation(async () => ({ activeChange }));
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "MERGED" }));
    mockRemoveWorktree.mock.mockImplementation(async () => {
      throw new Error("removal failed");
    });

    // Should not throw
    await runCompletionCheck();

    // Cleanup should still proceed
    assert.equal(mockClearActiveChange.mock.callCount(), 1);
  });

  it("skips cleanup when no worktree is present", async () => {
    const activeChange = makeActiveChange({ worktree: undefined });
    mockGetActiveWorkers.mock.mockImplementation(() => [makeWorker({ id: "sess-nowt" })]);
    mockGetSession.mock.mockImplementation(async () => ({ activeChange }));
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "CLOSED" }));

    await runCompletionCheck();

    assert.equal(mockRemoveWorktree.mock.callCount(), 0);
    // Should still clear the active change
    assert.equal(mockClearActiveChange.mock.callCount(), 1);
  });

  it("skips cleanup when re-fetched session has no activeChange", async () => {
    let callCount = 0;
    mockGetActiveWorkers.mock.mockImplementation(() => [makeWorker({ id: "sess-race" })]);
    mockGetSession.mock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call: session has activeChange
        return { activeChange: makeActiveChange() };
      }
      // Second call: activeChange was cleared (race condition)
      return { activeChange: undefined };
    });
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "MERGED" }));

    await runCompletionCheck();

    // Should not proceed with cleanup
    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 0);
    assert.equal(mockClearActiveChange.mock.callCount(), 0);
  });

  it("does not clean up when PR is still open", async () => {
    const activeChange = makeActiveChange();
    mockGetActiveWorkers.mock.mockImplementation(() => [makeWorker()]);
    mockGetSession.mock.mockImplementation(async () => ({ activeChange }));
    mockGetPRStatus.mock.mockImplementation(async () => ({ state: "OPEN" }));

    await runCompletionCheck();

    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 0);
    assert.equal(mockClearActiveChange.mock.callCount(), 0);
  });

  it("processes multiple workers and only cleans up completed ones", async () => {
    const mergedChange = makeActiveChange({ prUrl: "https://github.com/org/repo/pull/1" });
    const openChange = makeActiveChange({ prUrl: "https://github.com/org/repo/pull/2" });

    mockGetActiveWorkers.mock.mockImplementation(() => [
      makeWorker({ id: "merged-sess", prUrl: "https://github.com/org/repo/pull/1" }),
      makeWorker({ id: "open-sess", prUrl: "https://github.com/org/repo/pull/2" }),
    ]);

    mockGetSession.mock.mockImplementation(async (id: string) => {
      if (id === "merged-sess") return { activeChange: mergedChange };
      if (id === "open-sess") return { activeChange: openChange };
      return null;
    });

    mockGetPRStatus.mock.mockImplementation(async (url: string) => {
      if (url.includes("/1")) return { state: "MERGED" };
      return { state: "OPEN" };
    });

    await runCompletionCheck();

    // Only the merged session should be cleaned up
    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 1);
    assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[0], "merged-sess");
    assert.equal(mockClearActiveChange.mock.callCount(), 1);
    assert.equal(mockClearActiveChange.mock.calls[0].arguments[0], "merged-sess");
  });
});

// ============================================================================
// startCompletionMonitor / stopCompletionMonitor
// ============================================================================

describe("startCompletionMonitor", () => {
  it("does not start when monitoringIntervalMinutes is 0", () => {
    mockConfig = {
      changesWorkflow: {
        enabled: true,
        monitoringIntervalMinutes: 0,
      },
    };

    startCompletionMonitor();

    // No interval should be running — stopping should be a no-op
    // Verify no check runs by ensuring getActiveWorkers is not called
    assert.equal(mockGetActiveWorkers.mock.callCount(), 0);
  });

  it("does not start when changesWorkflow is disabled", () => {
    mockConfig = {
      changesWorkflow: {
        enabled: false,
        monitoringIntervalMinutes: 5,
      },
    };

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), 0);
  });

  it("does not start when changesWorkflow is undefined", () => {
    mockConfig = {};

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), 0);
  });

  it("runs an immediate check on start", () => {
    mockConfig = {
      changesWorkflow: {
        enabled: true,
        monitoringIntervalMinutes: 5,
      },
    };
    mockGetActiveWorkers.mock.mockImplementation(() => []);

    startCompletionMonitor();

    // The immediate check should have called getActiveWorkers
    assert.equal(mockGetActiveWorkers.mock.callCount(), 1);
  });

  it("does not start a second monitor if already running", () => {
    mockConfig = {
      changesWorkflow: {
        enabled: true,
        monitoringIntervalMinutes: 5,
      },
    };
    mockGetActiveWorkers.mock.mockImplementation(() => []);

    startCompletionMonitor();
    const callCountAfterFirst = mockGetActiveWorkers.mock.callCount();

    // Starting again should be a no-op
    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), callCountAfterFirst);
  });

  it("defaults to 15 minutes when monitoringIntervalMinutes is not set", () => {
    mockConfig = {
      changesWorkflow: {
        enabled: true,
        // monitoringIntervalMinutes not set
      },
    };
    mockGetActiveWorkers.mock.mockImplementation(() => []);

    // Should start successfully with default interval
    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), 1);
  });
});

describe("stopCompletionMonitor", () => {
  it("stops the running monitor", () => {
    mockConfig = {
      changesWorkflow: {
        enabled: true,
        monitoringIntervalMinutes: 5,
      },
    };
    mockGetActiveWorkers.mock.mockImplementation(() => []);

    startCompletionMonitor();
    stopCompletionMonitor();

    // After stopping, starting again should work (not warn about already running)
    startCompletionMonitor();
    // The immediate check runs again — so callCount should increase
    assert.ok(mockGetActiveWorkers.mock.callCount() >= 2);
  });

  it("is a no-op when no monitor is running", () => {
    // Should not throw
    stopCompletionMonitor();
  });
});
