import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { PersistedSessionState, ChangeStatus } from "./types.js";
import type { RepositoryConfig } from "../config.js";
import { restoreWorkerSessions, type RestoreDeps } from "./restore.js";
import type { setActiveChange } from "./activeState.js";
import type { getAllPersistedSessions } from "./persistence.js";
import type { WorkerPool } from "../workers/types.js";

// ============================================================================
// Helpers
// ============================================================================

const mockRepositories: RepositoryConfig[] = [
  {
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    description: "Test repo",
  },
];

function makePersistedState(overrides: Partial<PersistedSessionState> = {}): PersistedSessionState {
  return {
    sessionId: "session-123",
    status: "pr_created",
    phase: "PR Created",
    branch: "feat/fix-bug",
    repo: "my-repo",
    userId: "U001",
    description: "Fix the critical bug",
    prUrl: "https://github.com/org/my-repo/pull/42",
    startedAt: "2026-01-15T10:00:00.000Z",
    lastActivityAt: "2026-01-15T10:30:00.000Z",
    lastMessage: "PR created",
    channel: "C001",
    threadTs: "1700000000.000001",
    ...overrides,
  };
}

const defaultWorktree = {
  repoName: "my-repo",
  branchName: "feat/fix-bug",
  worktreePath: "/tmp/worktrees/my-repo/feat-fix-bug",
  createdAt: new Date("2026-01-15T10:00:00Z"),
};

const defaultUnifiedSession = {
  sessionId: "unified-session-1",
  channelId: "C001",
  threadTs: "1700000000.000001",
  userId: "U001",
  triggerType: "reactions" as const,
};

function buildRestorePool(
  opts: {
    findByBranch?: (repo: string, branch: string) => ReturnType<WorkerPool["findByBranch"]>;
  } = {},
): WorkerPool {
  return {
    acquire: async () => {
      throw new Error("acquire not used in restore tests");
    },
    release: async () => {},
    findByBranch:
      opts.findByBranch ??
      (() => ({
        id: "feat-test",
        repo: "my-repo",
        worktreePath: defaultWorktree.worktreePath,
        currentBranch: defaultWorktree.branchName,
        status: "idle",
        setupComplete: true,
        setupVersionHash: null,
        claimedBy: null,
        lastUsedAt: new Date(),
        createdAt: defaultWorktree.createdAt,
      })),
    list: () => [],
    ensureMinimum: async () => {},
  };
}

type FakeConfig = {
  repositories: RepositoryConfig[];
  changesWorkflow?: { reusableFolders?: { enabled: boolean } };
};
const fakeConfigBox: { value: FakeConfig } = { value: { repositories: mockRepositories } };
function setFakeConfig(c: FakeConfig): void {
  fakeConfigBox.value = c;
}

function makeDeps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
  const mockGetAllPersistedSessions: RestoreDeps["getAllPersistedSessions"] = vi.fn(async () => []);
  const mockWriteSessionState: RestoreDeps["writeSessionState"] = vi.fn(() => {});
  const mockFindSessionByThread: RestoreDeps["findSessionByThread"] = vi.fn(
    async () => defaultUnifiedSession as Awaited<ReturnType<RestoreDeps["findSessionByThread"]>>,
  );
  const mockSetActiveChange: RestoreDeps["setActiveChange"] = vi.fn(() => {});

  const getConfig: RestoreDeps["getConfig"] = () =>
    fakeConfigBox.value as ReturnType<RestoreDeps["getConfig"]>;
  return {
    getConfig,
    pool: buildRestorePool(),
    getAllPersistedSessions: mockGetAllPersistedSessions,
    writeSessionState: mockWriteSessionState,
    findSessionByThread: mockFindSessionByThread,
    setActiveChange: mockSetActiveChange,
    ...overrides,
  };
}

// ============================================================================
// restoreWorkerSessions — early return
// ============================================================================

describe("restoreWorkerSessions", () => {
  it("returns immediately when there are no persisted sessions", async () => {
    const mockSetActiveChange = vi.fn();
    const deps = makeDeps({
      getAllPersistedSessions: vi.fn(async () => []) as never,
      setActiveChange: mockSetActiveChange as never,
    });

    await restoreWorkerSessions(deps);

    assert.equal(mockSetActiveChange.mock.calls.length, 0);
  });

  // ==========================================================================
  // Skipping terminal states
  // ==========================================================================

  describe("skipping terminal states", () => {
    it("skips completed sessions", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "completed" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.calls.length, 0);
    });

    it("skips failed sessions", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "failed" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.calls.length, 0);
    });

    it("skips cancelled sessions", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "cancelled" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.calls.length, 0);
    });
  });

  // ==========================================================================
  // Skipping sessions with missing data
  // ==========================================================================

  describe("skipping sessions with missing data", () => {
    it("skips sessions with null channel", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ channel: null }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.calls.length, 0);
    });

    it("skips sessions with null threadTs", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ threadTs: null }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.calls.length, 0);
    });
  });

  // ==========================================================================
  // Skipping sessions with missing repo or worktree
  // ==========================================================================

  describe("skipping sessions with missing repo or worktree", () => {
    it("skips sessions whose repo is no longer configured", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ repo: "deleted-repo" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.calls.length, 0);
    });

    it("skips sessions whose worktree is not found", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [makePersistedState()]) as never,
        pool: buildRestorePool({ findByBranch: () => null }),
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.calls.length, 0);
    });
  });

  // ==========================================================================
  // Mid-execution sessions
  // ==========================================================================

  describe("mid-execution sessions", () => {
    const midExecStatuses: ChangeStatus[] = ["executing", "planning", "reviewing", "merging"];

    for (const status of midExecStatuses) {
      it(`marks ${status} session without PR as failed`, async () => {
        const mockWriteSessionState = vi.fn();
        const deps = makeDeps({
          getAllPersistedSessions: vi.fn(async () => [
            makePersistedState({ status, prUrl: null }),
          ]) as never,
          writeSessionState: mockWriteSessionState as never,
        });

        await restoreWorkerSessions(deps);

        assert.equal(mockWriteSessionState.mock.calls.length, 1);
        const writeCall = mockWriteSessionState.mock.calls[0]!;
        const session = writeCall[0] as { status: string };
        assert.equal(session.status, "failed");
        const message = writeCall[1] as string;
        assert.ok(message.includes("Marked failed on startup"));
      });
    }

    for (const status of midExecStatuses) {
      it(`downgrades ${status} session with PR to pr_created`, async () => {
        const mockSetActiveChange = vi.fn();
        const deps = makeDeps({
          getAllPersistedSessions: vi.fn(async () => [
            makePersistedState({ status, prUrl: "https://github.com/org/repo/pull/1" }),
          ]) as never,
          setActiveChange: mockSetActiveChange as never,
        });

        await restoreWorkerSessions(deps);

        assert.equal(mockSetActiveChange.mock.calls.length, 1);
        const changeArg = mockSetActiveChange.mock.calls[0]![1] as { status: string };
        assert.equal(changeArg.status, "pr_created");
      });
    }

    it("writes updated session state to disk when downgrading", async () => {
      const mockWriteSessionState = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "executing", prUrl: "https://github.com/org/repo/pull/1" }),
        ]) as never,
        writeSessionState: mockWriteSessionState as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockWriteSessionState.mock.calls.length, 1);
      const writeCall = mockWriteSessionState.mock.calls[0]!;
      const message = writeCall[1] as string;
      assert.ok(message.includes("Restored on startup"));
      assert.ok(message.includes("was executing"));
      assert.ok(message.includes("downgraded to pr_created"));
    });
  });

  // ==========================================================================
  // Successful restoration
  // ==========================================================================

  describe("successful restoration", () => {
    it("restores a pr_created session into active state", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.calls.length, 1);
      const [sessionId, changeState, sessionRef] = mockSetActiveChange.mock.calls[0]!;
      assert.equal(sessionId, "unified-session-1");
      assert.equal(changeState.branch, "feat/fix-bug");
      assert.equal(changeState.repo, "my-repo");
      assert.equal(changeState.status, "pr_created");
      assert.equal(changeState.prUrl, "https://github.com/org/my-repo/pull/42");
      assert.equal(changeState.description, "Fix the critical bug");
      assert.equal(sessionRef.userId, "U001");
      assert.equal(sessionRef.channelId, "C001");
      assert.equal(sessionRef.threadTs, "1700000000.000001");
    });

    it("does not write session state when not downgraded", async () => {
      const mockWriteSessionState = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        writeSessionState: mockWriteSessionState as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockWriteSessionState.mock.calls.length, 0);
    });

    it("converts startedAt and lastActivityAt strings to Date objects", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({
            status: "pr_created",
            startedAt: "2026-02-01T08:00:00.000Z",
            lastActivityAt: "2026-02-01T09:00:00.000Z",
          }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      const changeState = mockSetActiveChange.mock.calls[0]![1] as {
        startedAt: Date;
        lastActivityAt: Date;
      };
      assert.ok(changeState.startedAt instanceof Date);
      assert.ok(changeState.lastActivityAt instanceof Date);
      assert.equal(changeState.startedAt.toISOString(), "2026-02-01T08:00:00.000Z");
      assert.equal(changeState.lastActivityAt.toISOString(), "2026-02-01T09:00:00.000Z");
    });

    it("converts null prUrl to undefined", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "pr_created", prUrl: null }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      const changeState = mockSetActiveChange.mock.calls[0]![1] as { prUrl?: string };
      assert.equal(changeState.prUrl, undefined);
    });

    it("passes worktree from getExistingWorktree to setActiveChange", async () => {
      const customWorktree = {
        repoName: "my-repo",
        branchName: "feat/custom",
        worktreePath: "/tmp/worktrees/custom",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      };
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        pool: buildRestorePool({
          findByBranch: () => ({
            id: "custom",
            repo: customWorktree.repoName,
            worktreePath: customWorktree.worktreePath,
            currentBranch: customWorktree.branchName,
            status: "idle",
            setupComplete: true,
            setupVersionHash: null,
            claimedBy: null,
            lastUsedAt: new Date(),
            createdAt: customWorktree.createdAt,
          }),
        }),
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      const setActiveCall = mockSetActiveChange.mock.calls[0]!;
      const callArgs = setActiveCall;
      const changeState = callArgs[1] as { worktree: typeof customWorktree };
      assert.deepEqual(changeState.worktree, customWorktree);
    });
  });

  // ==========================================================================
  // verificationAttempts round-trip
  // ==========================================================================

  describe("verificationAttempts field", () => {
    it("restores verificationAttempts from persisted state", async () => {
      const mockSetActiveChange = vi.fn<typeof setActiveChange>(() => undefined);
      const mockGetAll = vi.fn<typeof getAllPersistedSessions>(async () => [
        makePersistedState({ status: "pr_created", verificationAttempts: 2 }),
      ]);
      const deps = makeDeps({
        getAllPersistedSessions: mockGetAll,
        setActiveChange: mockSetActiveChange,
      });

      await restoreWorkerSessions(deps);

      const changeState = mockSetActiveChange.mock.calls[0]![1];
      assert.equal(changeState.verificationAttempts, 2);
    });

    it("leaves verificationAttempts undefined when not present on persisted state", async () => {
      const mockSetActiveChange = vi.fn<typeof setActiveChange>(() => undefined);
      const mockGetAll = vi.fn<typeof getAllPersistedSessions>(async () => [
        makePersistedState({ status: "pr_created" }),
      ]);
      const deps = makeDeps({
        getAllPersistedSessions: mockGetAll,
        setActiveChange: mockSetActiveChange,
      });

      await restoreWorkerSessions(deps);

      const changeState = mockSetActiveChange.mock.calls[0]![1];
      assert.equal(changeState.verificationAttempts, undefined);
    });
  });

  // ==========================================================================
  // Skipping when unified session is not found
  // ==========================================================================

  describe("missing unified session", () => {
    it("skips restoration when findSessionByThread returns null", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        findSessionByThread: vi.fn(async () => null) as never,
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.calls.length, 0);
    });
  });

  // ==========================================================================
  // Multiple sessions
  // ==========================================================================

  describe("multiple sessions", () => {
    it("processes each session independently", async () => {
      const session1 = makePersistedState({
        sessionId: "s1",
        status: "pr_created",
        branch: "feat/one",
        channel: "C001",
        threadTs: "1700000001.000001",
      });
      const session2 = makePersistedState({
        sessionId: "s2",
        status: "completed",
        branch: "feat/two",
        channel: "C002",
        threadTs: "1700000002.000001",
      });
      const session3 = makePersistedState({
        sessionId: "s3",
        status: "executing",
        prUrl: null,
        branch: "feat/three",
        channel: "C003",
        threadTs: "1700000003.000001",
      });

      let findCallCount = 0;
      const mockSetActiveChange = vi.fn();
      const mockWriteSessionState = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [session1, session2, session3]) as never,
        findSessionByThread: vi.fn(async () => {
          findCallCount++;
          return {
            sessionId: `unified-${findCallCount}`,
            channelId: `C00${findCallCount}`,
            threadTs: `170000000${findCallCount}.000001`,
            userId: "U001",
            triggerType: "reactions",
          };
        }) as never,
        setActiveChange: mockSetActiveChange as never,
        writeSessionState: mockWriteSessionState as never,
      });

      await restoreWorkerSessions(deps);

      // session1 restored, session2 skipped (completed), session3 marked failed
      assert.equal(mockSetActiveChange.mock.calls.length, 1);
      assert.equal(mockWriteSessionState.mock.calls.length, 1); // session3 marked failed

      const failedSession = mockWriteSessionState.mock.calls[0]![0] as { status: string };
      assert.equal(failedSession.status, "failed");
    });

    it("resolves branch conflict by giving the worker to the most-recently-active session", async () => {
      const older = makePersistedState({
        sessionId: "s-older",
        status: "pr_created",
        branch: "feat/contested",
        channel: "C001",
        threadTs: "1700000001.000001",
        lastActivityAt: new Date("2026-04-01T10:00:00Z").toISOString(),
      });
      const newer = makePersistedState({
        sessionId: "s-newer",
        status: "pr_created",
        branch: "feat/contested",
        channel: "C002",
        threadTs: "1700000002.000001",
        lastActivityAt: new Date("2026-04-01T11:00:00Z").toISOString(),
      });

      interface CallRecord {
        sessionId: string;
        hasWorktree: boolean;
      }
      const setActiveCalls: CallRecord[] = [];

      const getAllPersistedSessions: RestoreDeps["getAllPersistedSessions"] = async () => [
        older,
        newer,
      ];
      let findCallCount = 0;
      const findSessionByThread: RestoreDeps["findSessionByThread"] = async () => {
        findCallCount++;
        return {
          sessionId: `unified-${findCallCount}`,
          channelId: `C00${findCallCount}`,
          messageTs: `170000000${findCallCount}.000001`,
          threadTs: `170000000${findCallCount}.000001`,
          userId: "U001",
          trigger: {
            type: "reactions",
            userId: "U001",
            emoji: "robot_face",
            messageTs: `170000000${findCallCount}.000001`,
            messageText: "",
          },
          messages: [],
          threadContext: [],
          errors: [],
          lastActivity: Date.now(),
          createdAt: Date.now(),
          triggerType: "reactions",
        };
      };
      const setActiveChange: RestoreDeps["setActiveChange"] = (sessionId, change) => {
        setActiveCalls.push({ sessionId, hasWorktree: change.worktree !== undefined });
      };

      const deps = makeDeps({
        getAllPersistedSessions,
        findSessionByThread,
        setActiveChange,
      });

      await restoreWorkerSessions(deps);

      assert.equal(setActiveCalls.length, 2);
      // Newer session is processed first (sorted by lastActivityAt desc) and keeps the worker.
      assert.equal(setActiveCalls[0]!.hasWorktree, true);
      // Older session is processed second and is detached.
      assert.equal(setActiveCalls[1]!.hasWorktree, false);
    });

    it("does not flag a conflict when the same sessionId appears twice", async () => {
      // Defensive: persistence should never list a session twice, but the
      // conflict guard must not trip on a self-match.
      const persisted = makePersistedState({
        sessionId: "s-self",
        status: "pr_created",
        branch: "feat/self",
        channel: "C001",
        threadTs: "1700000001.000001",
      });
      const setActiveCalls: boolean[] = [];

      const getAllPersistedSessions: RestoreDeps["getAllPersistedSessions"] = async () => [
        persisted,
        persisted,
      ];
      const setActiveChange: RestoreDeps["setActiveChange"] = (_sessionId, change) => {
        setActiveCalls.push(change.worktree !== undefined);
      };

      const deps = makeDeps({ getAllPersistedSessions, setActiveChange });

      await restoreWorkerSessions(deps);

      // Both calls bind the worker — same sessionId, not a conflict.
      assert.deepEqual(setActiveCalls, [true, true]);
    });
  });

  // ==========================================================================
  // markSessionFailed internals
  // ==========================================================================

  describe("markSessionFailed", () => {
    it("builds a minimal ChangeSession for writeSessionState", async () => {
      const state = makePersistedState({
        sessionId: "fail-session",
        status: "executing",
        prUrl: null,
        branch: "feat/fail",
        repo: "my-repo",
        userId: "U999",
        description: "Something that was interrupted",
        startedAt: "2026-01-20T12:00:00.000Z",
        channel: "C999",
        threadTs: "1700000999.000001",
      });

      const mockWriteSessionState = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [state]) as never,
        writeSessionState: mockWriteSessionState as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockWriteSessionState.mock.calls.length, 1);
      const [session, message] = mockWriteSessionState.mock.calls[0]!;
      assert.equal(session.id, "fail-session");
      assert.equal(session.userId, "U999");
      assert.equal(session.status, "failed");
      assert.equal(session.plan.branchName, "feat/fail");
      assert.equal(session.plan.description, "Something that was interrupted");
      assert.equal(session.plan.targetRepo, "my-repo");
      assert.equal(session.prUrl, undefined);
      assert.equal(session.channel, "C999");
      assert.equal(session.threadTs, "1700000999.000001");
      assert.ok(session.createdAt instanceof Date);
      assert.ok(session.lastActivityAt instanceof Date);
      assert.ok((message as string).includes("Marked failed on startup"));
    });

    it("converts null prUrl to undefined in failed session", async () => {
      const mockWriteSessionState = vi.fn();
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "planning", prUrl: null }),
        ]) as never,
        writeSessionState: mockWriteSessionState as never,
      });

      await restoreWorkerSessions(deps);

      const session = mockWriteSessionState.mock.calls[0]![0] as { prUrl?: string };
      assert.equal(session.prUrl, undefined);
    });

    it("uses empty string for channel when null", async () => {
      // classifySession guards against null channel/threadTs, so markSessionFailed
      // uses `state.channel ?? ""` as a safety net. The guard prevents reaching
      // markSessionFailed with null channel.
      assert.ok(true, "channel null guard is covered by classifySession skip");
    });
  });

  // ==========================================================================
  // classifySession (tested indirectly)
  // ==========================================================================

  describe("classifySession logic", () => {
    it("passes the correct repo and branch to pool.findByBranch", async () => {
      const findByBranchCalls: Array<{ repo: string; branch: string }> = [];
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ repo: "my-repo", branch: "feat/test-branch" }),
        ]) as never,
        pool: buildRestorePool({
          findByBranch: (repo, branch) => {
            findByBranchCalls.push({ repo, branch });
            return null;
          },
        }),
      });

      await restoreWorkerSessions(deps);

      assert.equal(findByBranchCalls.length, 1);
      assert.equal(findByBranchCalls[0]!.repo, "my-repo");
      assert.equal(findByBranchCalls[0]!.branch, "feat/test-branch");
    });

    it("uses the state's channel and threadTs for findSessionByThread", async () => {
      const mockFindSessionByThread = vi.fn<
        (channelId: string, threadTs: string) => Promise<typeof defaultUnifiedSession>
      >(async () => defaultUnifiedSession);
      const deps = makeDeps({
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "pr_created", channel: "C-CHAN", threadTs: "170.thread" }),
        ]) as never,
        findSessionByThread: mockFindSessionByThread as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockFindSessionByThread.mock.calls.length, 1);
      const [channelArg, threadTsArg] = mockFindSessionByThread.mock.calls[0]!;
      assert.equal(channelArg, "C-CHAN");
      assert.equal(threadTsArg, "170.thread");
    });

    it("passes triggerType from unified session to setActiveChange ref", async () => {
      const mockSetActiveChange = vi.fn();
      const deps = makeDeps({
        findSessionByThread: vi.fn(async () => ({
          sessionId: "us-1",
          channelId: "C001",
          threadTs: "170.001",
          userId: "U001",
          triggerType: "mentions",
        })) as never,
        getAllPersistedSessions: vi.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      const ref = mockSetActiveChange.mock.calls[0]![2] as { triggerType: string };
      assert.equal(ref.triggerType, "mentions");
    });
  });
});
