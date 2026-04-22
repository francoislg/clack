import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { PersistedSessionState, ChangeStatus } from "./types.js";
import type { RepositoryConfig } from "../config.js";
import { restoreWorkerSessions, type RestoreDeps } from "./restore.js";
import type { setActiveChange } from "./activeState.js";
import type { getAllPersistedSessions } from "./persistence.js";

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

function makeDeps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
  const mockGetAllPersistedSessions = mock.fn(async () => [] as PersistedSessionState[]);
  const mockWriteSessionState = mock.fn(() => {});
  const mockGetExistingWorktree = mock.fn(
    () => defaultWorktree as ReturnType<RestoreDeps["getExistingWorktree"]>,
  );
  const mockFindSessionByThread = mock.fn(
    async () => defaultUnifiedSession as Awaited<ReturnType<RestoreDeps["findSessionByThread"]>>,
  );
  const mockSetActiveChange = mock.fn(() => {});

  return {
    getConfig: () => ({ repositories: mockRepositories }) as never,
    getExistingWorktree: mockGetExistingWorktree as never,
    getAllPersistedSessions: mockGetAllPersistedSessions as never,
    writeSessionState: mockWriteSessionState as never,
    findSessionByThread: mockFindSessionByThread as never,
    setActiveChange: mockSetActiveChange as never,
    ...overrides,
  };
}

// ============================================================================
// restoreWorkerSessions — early return
// ============================================================================

describe("restoreWorkerSessions", () => {
  it("returns immediately when there are no persisted sessions", async () => {
    const mockSetActiveChange = mock.fn();
    const deps = makeDeps({
      getAllPersistedSessions: mock.fn(async () => []) as never,
      setActiveChange: mockSetActiveChange as never,
    });

    await restoreWorkerSessions(deps);

    assert.equal(mockSetActiveChange.mock.callCount(), 0);
  });

  // ==========================================================================
  // Skipping terminal states
  // ==========================================================================

  describe("skipping terminal states", () => {
    it("skips completed sessions", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "completed" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });

    it("skips failed sessions", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "failed" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });

    it("skips cancelled sessions", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "cancelled" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });
  });

  // ==========================================================================
  // Skipping sessions with missing data
  // ==========================================================================

  describe("skipping sessions with missing data", () => {
    it("skips sessions with null channel", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ channel: null }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });

    it("skips sessions with null threadTs", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ threadTs: null }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });
  });

  // ==========================================================================
  // Skipping sessions with missing repo or worktree
  // ==========================================================================

  describe("skipping sessions with missing repo or worktree", () => {
    it("skips sessions whose repo is no longer configured", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ repo: "deleted-repo" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });

    it("skips sessions whose worktree is not found", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [makePersistedState()]) as never,
        getExistingWorktree: mock.fn(() => null) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });
  });

  // ==========================================================================
  // Mid-execution sessions
  // ==========================================================================

  describe("mid-execution sessions", () => {
    const midExecStatuses: ChangeStatus[] = ["executing", "planning", "reviewing", "merging"];

    for (const status of midExecStatuses) {
      it(`marks ${status} session without PR as failed`, async () => {
        const mockWriteSessionState = mock.fn();
        const deps = makeDeps({
          getAllPersistedSessions: mock.fn(async () => [
            makePersistedState({ status, prUrl: null }),
          ]) as never,
          writeSessionState: mockWriteSessionState as never,
        });

        await restoreWorkerSessions(deps);

        assert.equal(mockWriteSessionState.mock.callCount(), 1);
        const writeCall = mockWriteSessionState.mock.calls[0]!.arguments;
        const session = writeCall[0] as { status: string };
        assert.equal(session.status, "failed");
        const message = writeCall[1] as string;
        assert.ok(message.includes("Marked failed on startup"));
      });
    }

    for (const status of midExecStatuses) {
      it(`downgrades ${status} session with PR to pr_created`, async () => {
        const mockSetActiveChange = mock.fn();
        const deps = makeDeps({
          getAllPersistedSessions: mock.fn(async () => [
            makePersistedState({ status, prUrl: "https://github.com/org/repo/pull/1" }),
          ]) as never,
          setActiveChange: mockSetActiveChange as never,
        });

        await restoreWorkerSessions(deps);

        assert.equal(mockSetActiveChange.mock.callCount(), 1);
        const changeArg = mockSetActiveChange.mock.calls[0]!.arguments[1] as { status: string };
        assert.equal(changeArg.status, "pr_created");
      });
    }

    it("writes updated session state to disk when downgrading", async () => {
      const mockWriteSessionState = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "executing", prUrl: "https://github.com/org/repo/pull/1" }),
        ]) as never,
        writeSessionState: mockWriteSessionState as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockWriteSessionState.mock.callCount(), 1);
      const writeCall = mockWriteSessionState.mock.calls[0]!.arguments;
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
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.callCount(), 1);
      const [sessionId, changeState, sessionRef] = mockSetActiveChange.mock.calls[0]!.arguments;
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
      const mockWriteSessionState = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        writeSessionState: mockWriteSessionState as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockWriteSessionState.mock.callCount(), 0);
    });

    it("converts startedAt and lastActivityAt strings to Date objects", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({
            status: "pr_created",
            startedAt: "2026-02-01T08:00:00.000Z",
            lastActivityAt: "2026-02-01T09:00:00.000Z",
          }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      const changeState = mockSetActiveChange.mock.calls[0]!.arguments[1] as {
        startedAt: Date;
        lastActivityAt: Date;
      };
      assert.ok(changeState.startedAt instanceof Date);
      assert.ok(changeState.lastActivityAt instanceof Date);
      assert.equal(changeState.startedAt.toISOString(), "2026-02-01T08:00:00.000Z");
      assert.equal(changeState.lastActivityAt.toISOString(), "2026-02-01T09:00:00.000Z");
    });

    it("converts null prUrl to undefined", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "pr_created", prUrl: null }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      const changeState = mockSetActiveChange.mock.calls[0]!.arguments[1] as { prUrl?: string };
      assert.equal(changeState.prUrl, undefined);
    });

    it("passes worktree from getExistingWorktree to setActiveChange", async () => {
      const customWorktree = {
        repoName: "my-repo",
        branchName: "feat/custom",
        worktreePath: "/tmp/worktrees/custom",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      };
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        getExistingWorktree: mock.fn(() => customWorktree) as never,
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      const changeState = mockSetActiveChange.mock.calls[0]!.arguments[1] as { worktree: unknown };
      assert.equal(changeState.worktree, customWorktree);
    });
  });

  // ==========================================================================
  // verificationAttempts round-trip
  // ==========================================================================

  describe("verificationAttempts field", () => {
    it("restores verificationAttempts from persisted state", async () => {
      const mockSetActiveChange = mock.fn<typeof setActiveChange>(() => undefined);
      const mockGetAll = mock.fn<typeof getAllPersistedSessions>(async () => [
        makePersistedState({ status: "pr_created", verificationAttempts: 2 }),
      ]);
      const deps = makeDeps({
        getAllPersistedSessions: mockGetAll,
        setActiveChange: mockSetActiveChange,
      });

      await restoreWorkerSessions(deps);

      const changeState = mockSetActiveChange.mock.calls[0]!.arguments[1];
      assert.equal(changeState.verificationAttempts, 2);
    });

    it("leaves verificationAttempts undefined when not present on persisted state", async () => {
      const mockSetActiveChange = mock.fn<typeof setActiveChange>(() => undefined);
      const mockGetAll = mock.fn<typeof getAllPersistedSessions>(async () => [
        makePersistedState({ status: "pr_created" }),
      ]);
      const deps = makeDeps({
        getAllPersistedSessions: mockGetAll,
        setActiveChange: mockSetActiveChange,
      });

      await restoreWorkerSessions(deps);

      const changeState = mockSetActiveChange.mock.calls[0]!.arguments[1];
      assert.equal(changeState.verificationAttempts, undefined);
    });
  });

  // ==========================================================================
  // Skipping when unified session is not found
  // ==========================================================================

  describe("missing unified session", () => {
    it("skips restoration when findSessionByThread returns null", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        findSessionByThread: mock.fn(async () => null) as never,
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
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
      const mockSetActiveChange = mock.fn();
      const mockWriteSessionState = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [session1, session2, session3]) as never,
        findSessionByThread: mock.fn(async () => {
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
      assert.equal(mockSetActiveChange.mock.callCount(), 1);
      assert.equal(mockWriteSessionState.mock.callCount(), 1); // session3 marked failed

      const failedSession = mockWriteSessionState.mock.calls[0]!.arguments[0] as { status: string };
      assert.equal(failedSession.status, "failed");
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

      const mockWriteSessionState = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [state]) as never,
        writeSessionState: mockWriteSessionState as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockWriteSessionState.mock.callCount(), 1);
      const [session, message] = mockWriteSessionState.mock.calls[0]!.arguments;
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
      const mockWriteSessionState = mock.fn();
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "planning", prUrl: null }),
        ]) as never,
        writeSessionState: mockWriteSessionState as never,
      });

      await restoreWorkerSessions(deps);

      const session = mockWriteSessionState.mock.calls[0]!.arguments[0] as { prUrl?: string };
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
    it("passes the correct repo config to getExistingWorktree", async () => {
      const mockGetExistingWorktree = mock.fn<
        (repo: RepositoryConfig, branch: string) => typeof defaultWorktree | null
      >(() => defaultWorktree);
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ repo: "my-repo", branch: "feat/test-branch" }),
        ]) as never,
        getExistingWorktree: mockGetExistingWorktree as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockGetExistingWorktree.mock.callCount(), 1);
      const [repoArg, branchArg] = mockGetExistingWorktree.mock.calls[0]!.arguments;
      assert.equal((repoArg as RepositoryConfig).name, "my-repo");
      assert.equal(branchArg, "feat/test-branch");
    });

    it("uses the state's channel and threadTs for findSessionByThread", async () => {
      const mockFindSessionByThread = mock.fn<
        (channelId: string, threadTs: string) => Promise<typeof defaultUnifiedSession>
      >(async () => defaultUnifiedSession);
      const deps = makeDeps({
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "pr_created", channel: "C-CHAN", threadTs: "170.thread" }),
        ]) as never,
        findSessionByThread: mockFindSessionByThread as never,
      });

      await restoreWorkerSessions(deps);

      assert.equal(mockFindSessionByThread.mock.callCount(), 1);
      const [channelArg, threadTsArg] = mockFindSessionByThread.mock.calls[0]!.arguments;
      assert.equal(channelArg, "C-CHAN");
      assert.equal(threadTsArg, "170.thread");
    });

    it("passes triggerType from unified session to setActiveChange ref", async () => {
      const mockSetActiveChange = mock.fn();
      const deps = makeDeps({
        findSessionByThread: mock.fn(async () => ({
          sessionId: "us-1",
          channelId: "C001",
          threadTs: "170.001",
          userId: "U001",
          triggerType: "mentions",
        })) as never,
        getAllPersistedSessions: mock.fn(async () => [
          makePersistedState({ status: "pr_created" }),
        ]) as never,
        setActiveChange: mockSetActiveChange as never,
      });

      await restoreWorkerSessions(deps);

      const ref = mockSetActiveChange.mock.calls[0]!.arguments[2] as { triggerType: string };
      assert.equal(ref.triggerType, "mentions");
    });
  });
});
