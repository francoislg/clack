import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { ActiveChangeState } from "./activeState.js";
import type { ActiveWorker } from "./activeState.js";
import {
  checkSessionCompletion,
  runCompletionCheck,
  runIdleSweep,
  runQueueDrainBackstop,
  startCompletionMonitor,
  stopCompletionMonitor,
  setMonitorDeps,
  type IdleSweepPool,
  type MonitorDeps,
} from "./monitor.js";
import type { ReleaseReason, Worker, WorkerPool } from "../workers/types.js";
import type { RepositoryConfig } from "../config.js";

type ReleaseFn = (worker: Worker, reason: ReleaseReason) => Promise<void>;

function makeMockPool(overrides: Partial<WorkerPool> = {}): WorkerPool {
  const noopRelease: ReleaseFn = async () => {};
  const acquireStub = async (
    _repo: RepositoryConfig,
    _branch: string,
    _sessionId: string,
  ): Promise<Worker> => {
    throw new Error("acquire not used in monitor tests");
  };
  return {
    acquire: overrides.acquire ?? acquireStub,
    release: overrides.release ?? noopRelease,
    findByBranch: overrides.findByBranch ?? (() => null),
    list: overrides.list ?? (() => []),
    ensureMinimum: overrides.ensureMinimum ?? (async () => {}),
  };
}

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
    waiting: false,
    lastActivityAt: new Date(),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<MonitorDeps> = {}): MonitorDeps {
  return {
    getConfig: vi.fn(() => ({
      changesWorkflow: { enabled: true, monitoringIntervalMinutes: 5 },
    })) as never,
    pool: makeMockPool(),
    getPRStatus: vi.fn(async () => ({ state: "OPEN" })) as never,
    getSession: vi.fn(async () => null) as never,
    getActiveWorkers: vi.fn(() => []) as never,
    updateActiveChangeStatus: vi.fn() as never,
    clearActiveChange: vi.fn() as never,
    detachActiveChangeWorktree: () => {},
    getReusablePool: () => null,
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
        getPRStatus: vi.fn(async () => null) as never,
      }),
    );
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange);
    assert.equal(result.action, "none");
  });

  it("returns 'merged' when PR state is MERGED", async () => {
    setMonitorDeps(
      makeDeps({
        getPRStatus: vi.fn(async () => ({ state: "MERGED" })) as never,
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
        getPRStatus: vi.fn(async () => ({ state: "CLOSED" })) as never,
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
        getPRStatus: vi.fn(async () => ({ state: "OPEN" })) as never,
      }),
    );
    const activeChange = makeActiveChange();
    const result = await checkSessionCompletion(activeChange);
    assert.equal(result.action, "none");
    assert.equal(result.prState, "OPEN");
  });

  it("calls getPRStatus with the correct PR URL", async () => {
    const prUrl = "https://github.com/org/repo/pull/99";
    const mockGetPRStatus = vi.fn<(url: string) => Promise<{ state: string } | null>>(async () => ({
      state: "OPEN",
    }));
    setMonitorDeps(
      makeDeps({
        getPRStatus: mockGetPRStatus as never,
      }),
    );
    const activeChange = makeActiveChange({ prUrl });
    await checkSessionCompletion(activeChange);
    assert.equal(mockGetPRStatus.mock.calls.length, 1);
    assert.equal(mockGetPRStatus.mock.calls[0]![0], prUrl);
  });
});

// ============================================================================
// runCompletionCheck
// ============================================================================

describe("runCompletionCheck", () => {
  it("does nothing when there are no active workers", async () => {
    const mockGetPRStatus = vi.fn(async () => ({ state: "OPEN" }));
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => []) as never,
        getPRStatus: mockGetPRStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockGetPRStatus.mock.calls.length, 0);
  });

  it("skips workers without pr_created status", async () => {
    const mockGetPRStatus = vi.fn(async () => ({ state: "OPEN" }));
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker({ status: "executing" })]) as never,
        getPRStatus: mockGetPRStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockGetPRStatus.mock.calls.length, 0);
  });

  it("skips workers without a prUrl", async () => {
    const mockGetPRStatus = vi.fn(async () => ({ state: "OPEN" }));
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [
          makeWorker({ status: "pr_created", prUrl: undefined }),
        ]) as never,
        getPRStatus: mockGetPRStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockGetPRStatus.mock.calls.length, 0);
  });

  it("skips workers when getSession returns null", async () => {
    const mockUpdateStatus = vi.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker()]) as never,
        getSession: vi.fn(async () => null) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockUpdateStatus.mock.calls.length, 0);
  });

  it("skips workers when session has no activeChange", async () => {
    const mockUpdateStatus = vi.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker()]) as never,
        getSession: vi.fn(async () => ({
          activeChange: undefined,
        })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
      }),
    );
    await runCompletionCheck();
    assert.equal(mockUpdateStatus.mock.calls.length, 0);
  });

  it("cleans up a session when its PR has been merged externally", async () => {
    const activeChange = makeActiveChange();
    const mockUpdateStatus = vi.fn();
    const mockClearActiveChange = vi.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker({ id: "sess-1" })]) as never,
        getSession: vi.fn(async () => ({ activeChange })) as never,
        getPRStatus: vi.fn(async () => ({ state: "MERGED" })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.calls.length, 1);
    assert.equal(mockUpdateStatus.mock.calls[0]![0], "sess-1");
    assert.equal(mockUpdateStatus.mock.calls[0]![1], "completed");
    assert.equal(mockUpdateStatus.mock.calls[0]![2], "PR merged externally");

    assert.equal(mockClearActiveChange.mock.calls.length, 1);
    assert.equal(mockClearActiveChange.mock.calls[0]![0], "sess-1");
    assert.equal(mockClearActiveChange.mock.calls[0]![1], true);
  });

  it("cleans up a session when its PR has been closed externally", async () => {
    const activeChange = makeActiveChange();
    const mockUpdateStatus = vi.fn();
    const mockClearActiveChange = vi.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker({ id: "sess-2" })]) as never,
        getSession: vi.fn(async () => ({ activeChange })) as never,
        getPRStatus: vi.fn(async () => ({ state: "CLOSED" })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.calls.length, 1);
    assert.equal(mockUpdateStatus.mock.calls[0]![1], "failed");
    assert.equal(mockUpdateStatus.mock.calls[0]![2], "PR closed externally");

    assert.equal(mockClearActiveChange.mock.calls.length, 1);
    assert.equal(mockClearActiveChange.mock.calls[0]![1], false);
  });

  it("releases worker during cleanup when worktree info is present", async () => {
    const activeChange = makeActiveChange({
      worktree: {
        repoName: "my-repo",
        branchName: "feat/test",
        worktreePath: "/tmp/wt/my-repo/feat-test",
        createdAt: new Date(),
      },
    });
    const releaseCalls: Array<{ workerId: string; reason: ReleaseReason }> = [];
    const mockRelease: ReleaseFn = async (worker, reason) => {
      releaseCalls.push({ workerId: worker.id, reason });
    };
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker({ id: "sess-wt" })]) as never,
        getSession: vi.fn(async () => ({ activeChange })) as never,
        getPRStatus: vi.fn(async () => ({ state: "MERGED" })) as never,
        pool: makeMockPool({ release: mockRelease }),
      }),
    );

    await runCompletionCheck();

    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0]!.reason, "pr_merged");
  });

  it("does not throw when worker release fails", async () => {
    const activeChange = makeActiveChange();
    const mockClearActiveChange = vi.fn();
    const failingRelease: ReleaseFn = async () => {
      throw new Error("removal failed");
    };
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker({ id: "sess-err" })]) as never,
        getSession: vi.fn(async () => ({ activeChange })) as never,
        getPRStatus: vi.fn(async () => ({ state: "MERGED" })) as never,
        pool: makeMockPool({ release: failingRelease }),
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();
    assert.equal(mockClearActiveChange.mock.calls.length, 1);
  });

  it("skips cleanup when no worktree is present", async () => {
    const activeChange = makeActiveChange({ worktree: undefined });
    const releaseCalls: number[] = [];
    const mockRelease: ReleaseFn = async () => {
      releaseCalls.push(1);
    };
    const mockClearActiveChange = vi.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker({ id: "sess-nowt" })]) as never,
        getSession: vi.fn(async () => ({ activeChange })) as never,
        getPRStatus: vi.fn(async () => ({ state: "CLOSED" })) as never,
        pool: makeMockPool({ release: mockRelease }),
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(releaseCalls.length, 0);
    assert.equal(mockClearActiveChange.mock.calls.length, 1);
  });

  it("skips cleanup when re-fetched session has no activeChange", async () => {
    let callCount = 0;
    const mockUpdateStatus = vi.fn();
    const mockClearActiveChange = vi.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker({ id: "sess-race" })]) as never,
        getSession: vi.fn(async () => {
          callCount++;
          if (callCount === 1) return { activeChange: makeActiveChange() };
          return { activeChange: undefined };
        }) as never,
        getPRStatus: vi.fn(async () => ({ state: "MERGED" })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.calls.length, 0);
    assert.equal(mockClearActiveChange.mock.calls.length, 0);
  });

  it("does not clean up when PR is still open", async () => {
    const activeChange = makeActiveChange();
    const mockUpdateStatus = vi.fn();
    const mockClearActiveChange = vi.fn();
    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [makeWorker()]) as never,
        getSession: vi.fn(async () => ({ activeChange })) as never,
        getPRStatus: vi.fn(async () => ({ state: "OPEN" })) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.calls.length, 0);
    assert.equal(mockClearActiveChange.mock.calls.length, 0);
  });

  it("processes multiple workers and only cleans up completed ones", async () => {
    const mergedChange = makeActiveChange({ prUrl: "https://github.com/org/repo/pull/1" });
    const openChange = makeActiveChange({ prUrl: "https://github.com/org/repo/pull/2" });
    const mockUpdateStatus = vi.fn();
    const mockClearActiveChange = vi.fn();

    setMonitorDeps(
      makeDeps({
        getActiveWorkers: vi.fn(() => [
          makeWorker({ id: "merged-sess", prUrl: "https://github.com/org/repo/pull/1" }),
          makeWorker({ id: "open-sess", prUrl: "https://github.com/org/repo/pull/2" }),
        ]) as never,
        getSession: vi.fn(async (id: string) => {
          if (id === "merged-sess") return { activeChange: mergedChange };
          if (id === "open-sess") return { activeChange: openChange };
          return null;
        }) as never,
        getPRStatus: vi.fn(async (url: string) => {
          if (url.includes("/1")) return { state: "MERGED" };
          return { state: "OPEN" };
        }) as never,
        updateActiveChangeStatus: mockUpdateStatus as never,
        clearActiveChange: mockClearActiveChange as never,
      }),
    );

    await runCompletionCheck();

    assert.equal(mockUpdateStatus.mock.calls.length, 1);
    assert.equal(mockUpdateStatus.mock.calls[0]![0], "merged-sess");
    assert.equal(mockClearActiveChange.mock.calls.length, 1);
    assert.equal(mockClearActiveChange.mock.calls[0]![0], "merged-sess");
  });
});

// ============================================================================
// startCompletionMonitor / stopCompletionMonitor
// ============================================================================

describe("startCompletionMonitor", () => {
  it("does not start when monitoringIntervalMinutes is 0", () => {
    const mockGetActiveWorkers = vi.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: vi.fn(() => ({
          changesWorkflow: { enabled: true, monitoringIntervalMinutes: 0 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.calls.length, 0);
  });

  it("does not start when changesWorkflow is disabled", () => {
    const mockGetActiveWorkers = vi.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: vi.fn(() => ({
          changesWorkflow: { enabled: false, monitoringIntervalMinutes: 5 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.calls.length, 0);
  });

  it("does not start when changesWorkflow is undefined", () => {
    const mockGetActiveWorkers = vi.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: vi.fn(() => ({})) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.calls.length, 0);
  });

  it("runs an immediate check on start", () => {
    const mockGetActiveWorkers = vi.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: vi.fn(() => ({
          changesWorkflow: { enabled: true, monitoringIntervalMinutes: 5 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.calls.length, 1);
  });

  it("does not start a second monitor if already running", () => {
    const mockGetActiveWorkers = vi.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: vi.fn(() => ({
          changesWorkflow: { enabled: true, monitoringIntervalMinutes: 5 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    const callCountAfterFirst = mockGetActiveWorkers.mock.calls.length;
    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.calls.length, callCountAfterFirst);
  });

  it("defaults to 15 minutes when monitoringIntervalMinutes is not set", () => {
    const mockGetActiveWorkers = vi.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: vi.fn(() => ({
          changesWorkflow: { enabled: true },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    assert.equal(mockGetActiveWorkers.mock.calls.length, 1);
  });
});

describe("stopCompletionMonitor", () => {
  it("stops the running monitor", () => {
    const mockGetActiveWorkers = vi.fn(() => []);
    setMonitorDeps(
      makeDeps({
        getConfig: vi.fn(() => ({
          changesWorkflow: { enabled: true, monitoringIntervalMinutes: 5 },
        })) as never,
        getActiveWorkers: mockGetActiveWorkers as never,
      }),
    );

    startCompletionMonitor();
    stopCompletionMonitor();

    startCompletionMonitor();
    assert.ok(mockGetActiveWorkers.mock.calls.length >= 2);
  });

  it("is a no-op when no monitor is running", () => {
    stopCompletionMonitor();
  });
});

// ============================================================================
// runIdleSweep
// ============================================================================

function makeWorkerRecord(over: Partial<Worker> = {}): Worker {
  return {
    id: "worker-1",
    repo: "my-repo",
    worktreePath: "/tmp/wt/my-repo/worker-1",
    currentBranch: "feat/idle",
    status: "busy",
    setupComplete: true,
    setupVersionHash: null,
    claimedBy: "session-1",
    lastUsedAt: new Date(Date.now() - 25 * 3600_000),
    createdAt: new Date(),
    ...over,
  };
}

function makeSweepPool(over: {
  candidates?: Worker[];
  detachIfClean?: (w: Worker, o?: { treatUnpushedAsDirty?: boolean }) => Promise<boolean>;
  pumpQueuedRepos?: () => void;
}): IdleSweepPool {
  return {
    idleSweepCandidates: async () => over.candidates ?? [],
    detachIfClean: over.detachIfClean ?? (async () => true),
    pumpQueuedRepos: over.pumpQueuedRepos ?? (() => {}),
  };
}

type SessionFn = MonitorDeps["getSession"];
type DetachFn = MonitorDeps["detachActiveChangeWorktree"];

function sessionReturning(activeChange: ActiveChangeState | undefined): SessionFn {
  const session: Awaited<ReturnType<SessionFn>> = {
    sessionId: "session-1",
    channelId: "C001",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000001",
    userId: "U001",
    trigger: {
      type: "reactions",
      userId: "U001",
      emoji: "robot_face",
      messageTs: "1700000000.000001",
      messageText: "",
    },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    activeChange,
  };
  const fn: SessionFn = async () => session;
  return fn;
}

function makeFakeHandle(): ActiveChangeState["handle"] {
  const handle: ActiveChangeState["handle"] = {
    sendUpdate: async () => {},
    stop: async () => {},
    futureResponse: Promise.resolve({ success: true, answer: "" }),
    status: "running",
    hasPendingInput: () => false,
    consumePendingPushedTexts: () => [],
    hasDelivered: () => false,
  };
  return handle;
}

describe("runIdleSweep", () => {
  it("is a no-op when reusable mode is off (getReusablePool returns null)", async () => {
    const detachCalls: number[] = [];
    const detachStub: DetachFn = () => {
      detachCalls.push(1);
    };
    setMonitorDeps(
      makeDeps({
        getReusablePool: () => null,
        detachActiveChangeWorktree: detachStub,
      }),
    );
    await runIdleSweep();
    assert.equal(detachCalls.length, 0);
  });

  it("does nothing when there are no idle candidates", async () => {
    const detachCalls: string[] = [];
    const detachStub: DetachFn = (sessionId) => {
      detachCalls.push(sessionId);
    };
    setMonitorDeps(
      makeDeps({
        getReusablePool: () => makeSweepPool({ candidates: [] }),
        detachActiveChangeWorktree: detachStub,
      }),
    );
    await runIdleSweep();
    assert.equal(detachCalls.length, 0);
  });

  it("detaches a clean worker bound to a pr_created session with no live handle", async () => {
    const worker = makeWorkerRecord({ claimedBy: "session-1" });
    const detachCalls: string[] = [];
    let detachedWorker: Worker | null = null;
    const detachStub: DetachFn = (sessionId) => {
      detachCalls.push(sessionId);
    };

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async (w) => {
              detachedWorker = w;
              return true;
            },
          }),
        getSession: sessionReturning(makeActiveChange({ status: "pr_created", handle: undefined })),
        detachActiveChangeWorktree: detachStub,
      }),
    );

    await runIdleSweep();

    assert.equal(detachedWorker, worker);
    assert.deepEqual(detachCalls, ["session-1"]);
  });

  it("skips workers whose session is not pr_created (still executing)", async () => {
    const worker = makeWorkerRecord({ claimedBy: "session-1" });
    let detachCalled = false;
    const detached: string[] = [];
    const detachStub: DetachFn = (s) => {
      detached.push(s);
    };

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async () => {
              detachCalled = true;
              return true;
            },
          }),
        getSession: sessionReturning(makeActiveChange({ status: "executing" })),
        detachActiveChangeWorktree: detachStub,
      }),
    );

    await runIdleSweep();

    assert.equal(detachCalled, false);
    assert.equal(detached.length, 0);
  });

  it("skips workers whose session has a live Claude run handle", async () => {
    const worker = makeWorkerRecord();
    let detachCalled = false;

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async () => {
              detachCalled = true;
              return true;
            },
          }),
        getSession: sessionReturning(
          makeActiveChange({ status: "pr_created", handle: makeFakeHandle() }),
        ),
      }),
    );

    await runIdleSweep();
    assert.equal(detachCalled, false);
  });

  it("does NOT detach the session when the worker is dirty (quarantined instead)", async () => {
    const worker = makeWorkerRecord();
    const detached: string[] = [];
    const detachStub: DetachFn = (s) => {
      detached.push(s);
    };

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async () => false, // dirty → quarantine, no detach
          }),
        getSession: sessionReturning(makeActiveChange({ status: "pr_created" })),
        detachActiveChangeWorktree: detachStub,
      }),
    );

    await runIdleSweep();
    assert.equal(detached.length, 0);
  });

  it("continues to next candidate when one detach throws", async () => {
    const w1 = makeWorkerRecord({ id: "worker-1", claimedBy: "session-1" });
    const w2 = makeWorkerRecord({
      id: "worker-2",
      claimedBy: "session-2",
      currentBranch: "feat/other",
    });
    const detached: string[] = [];
    const detachStub: DetachFn = (s) => {
      detached.push(s);
    };

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [w1, w2],
            detachIfClean: async (w) => {
              if (w.id === "worker-1") throw new Error("boom");
              return true;
            },
          }),
        getSession: sessionReturning(makeActiveChange({ status: "pr_created" })),
        detachActiveChangeWorktree: detachStub,
      }),
    );

    await runIdleSweep();
    assert.deepEqual(detached, ["session-2"]);
  });

  it("skips workers with no claimedBy", async () => {
    const worker = makeWorkerRecord({ claimedBy: null });
    let detachCalled = false;

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async () => {
              detachCalled = true;
              return true;
            },
          }),
      }),
    );

    await runIdleSweep();
    assert.equal(detachCalled, false);
  });

  it("skips workers whose session no longer has an activeChange", async () => {
    const worker = makeWorkerRecord();
    let detachCalled = false;

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async () => {
              detachCalled = true;
              return true;
            },
          }),
        getSession: sessionReturning(undefined),
      }),
    );

    await runIdleSweep();
    assert.equal(detachCalled, false);
  });

  it("releases a clean, fully-pushed worker bound to a failed session", async () => {
    const worker = makeWorkerRecord({ claimedBy: "session-1" });
    const detached: string[] = [];
    const detachStub: DetachFn = (s) => {
      detached.push(s);
    };
    let detachOptions: { treatUnpushedAsDirty?: boolean } | undefined;

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async (_w, o) => {
              detachOptions = o;
              return true;
            },
          }),
        getSession: sessionReturning(makeActiveChange({ status: "failed", handle: undefined })),
        detachActiveChangeWorktree: detachStub,
      }),
    );

    await runIdleSweep();

    assert.deepEqual(detached, ["session-1"]);
    assert.deepEqual(detachOptions, { treatUnpushedAsDirty: true });
  });

  it("does not apply unpushed-commit protection to pr_created sessions", async () => {
    const worker = makeWorkerRecord({ claimedBy: "session-1" });
    let detachOptions: { treatUnpushedAsDirty?: boolean } | undefined;

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async (_w, o) => {
              detachOptions = o;
              return true;
            },
          }),
        getSession: sessionReturning(makeActiveChange({ status: "pr_created", handle: undefined })),
      }),
    );

    await runIdleSweep();

    assert.deepEqual(detachOptions, { treatUnpushedAsDirty: false });
  });

  it("keeps the session bound when a failed worker is quarantined (dirty or unpushed)", async () => {
    const worker = makeWorkerRecord({ claimedBy: "session-1" });
    const detached: string[] = [];
    const detachStub: DetachFn = (s) => {
      detached.push(s);
    };

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async () => false,
          }),
        getSession: sessionReturning(makeActiveChange({ status: "failed", handle: undefined })),
        detachActiveChangeWorktree: detachStub,
      }),
    );

    await runIdleSweep();
    assert.equal(detached.length, 0);
  });

  it("never releases a failed session with a live Claude run handle", async () => {
    const worker = makeWorkerRecord({ claimedBy: "session-1" });
    let detachCalled = false;

    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            candidates: [worker],
            detachIfClean: async () => {
              detachCalled = true;
              return true;
            },
          }),
        getSession: sessionReturning(
          makeActiveChange({ status: "failed", handle: makeFakeHandle() }),
        ),
      }),
    );

    await runIdleSweep();
    assert.equal(detachCalled, false);
  });
});

describe("runQueueDrainBackstop", () => {
  it("is a no-op when reusable mode is off (getReusablePool returns null)", () => {
    setMonitorDeps(makeDeps({ getReusablePool: () => null }));
    assert.doesNotThrow(() => runQueueDrainBackstop());
  });

  it("delegates to the pool's queue drain when reusable mode is on", () => {
    let pumped = 0;
    setMonitorDeps(
      makeDeps({
        getReusablePool: () =>
          makeSweepPool({
            pumpQueuedRepos: () => {
              pumped++;
            },
          }),
      }),
    );

    runQueueDrainBackstop();

    assert.equal(pumped, 1);
  });
});
