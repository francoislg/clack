import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { ActiveChangeState } from "./activeState.js";
import type { ActiveWorker } from "./activeState.js";
import {
  checkSessionCompletion,
  runCompletionCheck,
  startCompletionMonitor,
  stopCompletionMonitor,
  setMonitorDeps,
  type MonitorDeps,
} from "./monitor.js";

// ============================================================================
// Helpers
// ============================================================================

function makeActiveChange(overrides: Partial<ActiveChangeState> = {}): ActiveChangeState {
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

function makeWorker(overrides: Partial<ActiveWorker> = {}): ActiveWorker {
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

function makeDeps(overrides: Partial<MonitorDeps> = {}): MonitorDeps {
  return {
    getConfig: mock.fn(() => ({
      changesWorkflow: { enabled: true, monitoringIntervalMinutes: 5 },
    })) as never,
    removeWorktree: mock.fn(async () => {}) as never,
    getPRStatus: mock.fn(async () => ({ state: "OPEN" })) as never,
    getSession: mock.fn(async () => null) as never,
    getActiveWorkers: mock.fn(() => []) as never,
    updateActiveChangeStatus: mock.fn() as never,
    clearActiveChange: mock.fn() as never,
    ...overrides,
  };
}

beforeEach(() => {
  setMonitorDeps(makeDeps());
  stopCompletionMonitor();
});

// ============================================================================
// checkSessionCompletion
// ============================================================================

describe("checkSessionCompletion", () => {
  it("returns 'none' when status is not pr_created", async () => {
    setMonitorDeps(makeDeps());
    const activeChange = makeActiveChange({ status: "executing" });
    const result = await checkSessionCompletion(activeChange);
    assert.equal(result.action, "none");
  });

  it("returns 'none' when prUrl is missing", async () => {
    setMonitorDeps(makeDeps());
    const activeChange = makeActiveChange({ status: "pr_created", prUrl: undefined });
    const result = await checkSessionCompletion(activeChange);
    assert.equal(result.action, "none");
  });

  it("returns 'none' when getPRStatus returns null", async () => {
    setMonitorDeps(
      makeDeps({
        getPRStatus: mock.fn(async () => null) as never,
      }),
    );
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange);
    assert.equal(result.action, "none");
  });

  it("returns 'merged' when PR state is MERGED", async () => {
    setMonitorDeps(
      makeDeps({
        getPRStatus: mock.fn(async () => ({ state: "MERGED" })) as never,
      }),
    );
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange);
    assert.equal(result.action, "merged");
    assert.equal(result.prState, "MERGED");
  });

  it("returns 'closed' when PR state is CLOSED", async () => {
    setMonitorDeps(
      makeDeps({
        getPRStatus: mock.fn(async () => ({ state: "CLOSED" })) as never,
      }),
    );
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange);
    assert.equal(result.action, "closed");
    assert.equal(result.prState, "CLOSED");
  });

  it("returns 'none' with prState when PR is still OPEN", async () => {
    setMonitorDeps(
      makeDeps({
        getPRStatus: mock.fn(async () => ({ state: "OPEN" })) as never,
      }),
    );
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange);
    assert.equal(result.action, "none");
    assert.equal(result.prState, "OPEN");
  });

  it("calls getPRStatus with the correct PR URL", async () => {
    const prUrl = "https://github.com/org/repo/pull/99";
    const mockGetPRStatus = mock.fn<(url: string) => Promise<{ state: string } | null>>(
      async () => ({ state: "OPEN" }),
    );
    setMonitorDeps(
      makeDeps({
        getPRStatus: mockGetPRStatus as never,
      }),
    );
    const activeChange = makeActiveChange({ prUrl });
    await checkSessionCompletion(activeChange);
    assert.equal(mockGetPRStatus.mock.callCount(), 1);
    assert.equal(mockGetPRStatus.mock.calls[0]!.arguments[0], prUrl);
  });
});

// ============================================================================
// runCompletionCheck
// ============================================================================

describe("runCompletionCheck", () => {
  it("does nothing when there are no active workers", async () => {
    const mockGetPRStatus = mock.fn(async () => ({ state: "OPEN" }));
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => []) as never,
        getPRStatus: mockGetPRStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockGetPRStatus.mock.callCount(), 0);
  });

  it("skips workers without pr_created status", async () => {
    const mockGetPRStatus = mock.fn(async () => ({ state: "OPEN" }));
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker({ status: "executing" })]) as never,
        getPRStatus: mockGetPRStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockGetPRStatus.mock.callCount(), 0);
  });

  it("skips workers without a prUrl", async () => {
    const mockGetPRStatus = mock.fn(async () => ({ state: "OPEN" }));
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [
          makeWorker({ status: "pr_created", prUrl: undefined }),
        ]) as never,
        getPRStatus: mockGetPRStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockGetPRStatus.mock.callCount(), 0);
  });

  it("skips workers when getSession returns null", async () => {
    const mockUpdateStatus = mock.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker()]) as never,
        getSession: mock.fn(async () => null) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockUpdateStatus.mock.callCount(), 0);
  });

  it("skips workers when session has no activeChange", async () => {
    const mockUpdateStatus = mock.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker()]) as never,
        getSession: mock.fn(async () => ({
          activeChange: undefined,
        })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockUpdateStatus.mock.callCount(), 0);
  });

  it("cleans up a session when its PR has been merged externally", async () => {
    const activeChange = makeActiveChange();
    const mockUpdateStatus = mock.fn();
    const mockClearActiveChange = mock.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker({ id: "sess-1" })]) as never,
        getSession: mock.fn(async () => ({ activeChange })) as never,
        getPRStatus: mock.fn(async () => ({ state: "MERGED" })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.callCount(), 1);
    assert.equal(mockUpdateStatus.mock.calls[0]!.arguments[0], "sess-1");
    assert.equal(mockUpdateStatus.mock.calls[0]!.arguments[1], "completed");
    assert.equal(mockUpdateStatus.mock.calls[0]!.arguments[2], "PR merged externally");

    assert.equal(mockClearActiveChange.mock.callCount(), 1);
    assert.equal(mockClearActiveChange.mock.calls[0]!.arguments[0], "sess-1");
    assert.equal(mockClearActiveChange.mock.calls[0]!.arguments[1], true);
  });

  it("cleans up a session when its PR has been closed externally", async () => {
    const activeChange = makeActiveChange();
    const mockUpdateStatus = mock.fn();
    const mockClearActiveChange = mock.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker({ id: "sess-2" })]) as never,
        getSession: mock.fn(async () => ({ activeChange })) as never,
        getPRStatus: mock.fn(async () => ({ state: "CLOSED" })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.callCount(), 1);
    assert.equal(mockUpdateStatus.mock.calls[0]!.arguments[1], "failed");
    assert.equal(mockUpdateStatus.mock.calls[0]!.arguments[2], "PR closed externally");

    assert.equal(mockClearActiveChange.mock.callCount(), 1);
    assert.equal(mockClearActiveChange.mock.calls[0]!.arguments[1], false);
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
    const mockRemoveWorktree = mock.fn<(repoName: string, worktreePath: string) => Promise<void>>(
      async () => {},
    );
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker({ id: "sess-wt" })]) as never,
        getSession: mock.fn(async () => ({ activeChange })) as never,
        getPRStatus: mock.fn(async () => ({ state: "MERGED" })) as never,
        removeWorktree: mockRemoveWorktree as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockRemoveWorktree.mock.callCount(), 1);
    assert.equal(mockRemoveWorktree.mock.calls[0]!.arguments[0], "my-repo");
    assert.equal(mockRemoveWorktree.mock.calls[0]!.arguments[1], "/tmp/wt/my-repo/feat-test");
  });

  it("does not throw when worktree removal fails", async () => {
    const activeChange = makeActiveChange();
    const mockClearActiveChange = mock.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker({ id: "sess-err" })]) as never,
        getSession: mock.fn(async () => ({ activeChange })) as never,
        getPRStatus: mock.fn(async () => ({ state: "MERGED" })) as never,
        removeWorktree: mock.fn(async () => {
          throw new Error("removal failed");
        }) as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();
    assert.equal(mockClearActiveChange.mock.callCount(), 1);
  });

  it("skips cleanup when no worktree is present", async () => {
    const activeChange = makeActiveChange({ worktree: undefined });
    const mockRemoveWorktree = mock.fn(async () => {});
    const mockClearActiveChange = mock.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker({ id: "sess-nowt" })]) as never,
        getSession: mock.fn(async () => ({ activeChange })) as never,
        getPRStatus: mock.fn(async () => ({ state: "CLOSED" })) as never,
        removeWorktree: mockRemoveWorktree as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockRemoveWorktree.mock.callCount(), 0);
    assert.equal(mockClearActiveChange.mock.callCount(), 1);
  });

  it("skips cleanup when re-fetched session has no activeChange", async () => {
    let callCount = 0;
    const mockUpdateStatus = mock.fn();
    const mockClearActiveChange = mock.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker({ id: "sess-race" })]) as never,
        getSession: mock.fn(async () => {
          callCount++;
          if (callCount === 1) return { activeChange: makeActiveChange() };
          return { activeChange: undefined };
        }) as never,
        getPRStatus: mock.fn(async () => ({ state: "MERGED" })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.callCount(), 0);
    assert.equal(mockClearActiveChange.mock.callCount(), 0);
  });

  it("does not clean up when PR is still open", async () => {
    const activeChange = makeActiveChange();
    const mockUpdateStatus = mock.fn();
    const mockClearActiveChange = mock.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [makeWorker()]) as never,
        getSession: mock.fn(async () => ({ activeChange })) as never,
        getPRStatus: mock.fn(async () => ({ state: "OPEN" })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.callCount(), 0);
    assert.equal(mockClearActiveChange.mock.callCount(), 0);
  });

  it("processes multiple workers and only cleans up completed ones", async () => {
    const mergedChange = makeActiveChange({ prUrl: "https://github.com/org/repo/pull/1" });
    const openChange = makeActiveChange({ prUrl: "https://github.com/org/repo/pull/2" });
    const mockUpdateStatus = mock.fn();
    const mockClearActiveChange = mock.fn();

    setMonitorDeps(
      makeDeps({
        getActiveWorkers: mock.fn(() => [
          makeWorker({ id: "merged-sess", prUrl: "https://github.com/org/repo/pull/1" }),
          makeWorker({ id: "open-sess", prUrl: "https://github.com/org/repo/pull/2" }),
        ]) as never,
        getSession: mock.fn(async (id: string) => {
          if (id === "merged-sess") return { activeChange: mergedChange };
          if (id === "open-sess") return { activeChange: openChange };
          return null;
        }) as never,
        getPRStatus: mock.fn(async (url: string) => {
          if (url.includes("/1")) return { state: "MERGED" };
          return { state: "OPEN" };
        }) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.callCount(), 1);
    assert.equal(mockUpdateStatus.mock.calls[0]!.arguments[0], "merged-sess");
    assert.equal(mockClearActiveChange.mock.callCount(), 1);
    assert.equal(mockClearActiveChange.mock.calls[0]!.arguments[0], "merged-sess");
  });
});

// ============================================================================
// startCompletionMonitor / stopCompletionMonitor
// ============================================================================

describe("startCompletionMonitor", () => {
  it("does not start when monitoringIntervalMinutes is 0", () => {
    const mockGetActiveWorkers = mock.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: mock.fn(() => ({
          changesWorkflow: { enabled: true, monitoringIntervalMinutes: 0 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), 0);
  });

  it("does not start when changesWorkflow is disabled", () => {
    const mockGetActiveWorkers = mock.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: mock.fn(() => ({
          changesWorkflow: { enabled: false, monitoringIntervalMinutes: 5 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), 0);
  });

  it("does not start when changesWorkflow is undefined", () => {
    const mockGetActiveWorkers = mock.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: mock.fn(() => ({})) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), 0);
  });

  it("runs an immediate check on start", () => {
    const mockGetActiveWorkers = mock.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: mock.fn(() => ({
          changesWorkflow: { enabled: true, monitoringIntervalMinutes: 5 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), 1);
  });

  it("does not start a second monitor if already running", () => {
    const mockGetActiveWorkers = mock.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: mock.fn(() => ({
          changesWorkflow: { enabled: true, monitoringIntervalMinutes: 5 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    const callCountAfterFirst = mockGetActiveWorkers.mock.callCount();
    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), callCountAfterFirst);
  });

  it("defaults to 15 minutes when monitoringIntervalMinutes is not set", () => {
    const mockGetActiveWorkers = mock.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: mock.fn(() => ({
          changesWorkflow: { enabled: true },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.callCount(), 1);
  });
});

describe("stopCompletionMonitor", () => {
  it("stops the running monitor", () => {
    const mockGetActiveWorkers = mock.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: mock.fn(() => ({
          changesWorkflow: { enabled: true, monitoringIntervalMinutes: 5 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    stopCompletionMonitor();

    startCompletionMonitor();
    assert.ok(mockGetActiveWorkers.mock.callCount() >= 2);
  });

  it("is a no-op when no monitor is running", () => {
    stopCompletionMonitor();
  });
});
