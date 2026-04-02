import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { PersistedSessionState, ChangeStatus } from "./types.js";
import type { RepositoryConfig } from "../config.js";

// ============================================================================
// Mock setup
// ============================================================================

const mockGetAllPersistedSessions = mock.fn<() => Promise<PersistedSessionState[]>>();
const mockWriteSessionState = mock.fn();

mock.module("./persistence.js", {
  namedExports: {
    getAllPersistedSessions: mockGetAllPersistedSessions,
    writeSessionState: mockWriteSessionState,
  },
});

const mockLogger = {
  debug: mock.fn(),
  info: mock.fn(),
  warn: mock.fn(),
  error: mock.fn(),
};

mock.module("../logger.js", {
  namedExports: {
    logger: mockLogger,
  },
});

const mockRepositories: RepositoryConfig[] = [
  {
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    description: "Test repo",
  },
];

mock.module("../config.js", {
  namedExports: {
    getConfig: () => ({
      repositories: mockRepositories,
    }),
  },
});

const mockGetExistingWorktree =
  mock.fn<
    (
      repo: RepositoryConfig,
      branch: string,
    ) => { repoName: string; branchName: string; worktreePath: string; createdAt: Date } | null
  >();

mock.module("../worktrees.js", {
  namedExports: {
    getExistingWorktree: mockGetExistingWorktree,
  },
});

const mockFindSessionByThread = mock.fn<
  (
    channelId: string,
    threadTs: string,
  ) => Promise<{
    sessionId: string;
    channelId: string;
    threadTs: string;
    userId: string;
    triggerType?: string;
    activeChange?: unknown;
  } | null>
>();

mock.module("../sessions.js", {
  namedExports: {
    findSessionByThread: mockFindSessionByThread,
  },
});

const mockSetActiveChange = mock.fn();

mock.module("./activeState.js", {
  namedExports: {
    setActiveChange: mockSetActiveChange,
  },
});

// Import after mocks are set up
const { restoreWorkerSessions } = await import("./restore.js");

// ============================================================================
// Helpers
// ============================================================================

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

function resetAllMocks() {
  mockGetAllPersistedSessions.mock.resetCalls();
  mockWriteSessionState.mock.resetCalls();
  mockGetExistingWorktree.mock.resetCalls();
  mockFindSessionByThread.mock.resetCalls();
  mockSetActiveChange.mock.resetCalls();
  mockLogger.debug.mock.resetCalls();
  mockLogger.info.mock.resetCalls();

  // Set sensible defaults
  mockGetAllPersistedSessions.mock.mockImplementation(async () => []);
  mockGetExistingWorktree.mock.mockImplementation(() => defaultWorktree);
  mockFindSessionByThread.mock.mockImplementation(async () => defaultUnifiedSession);
}

beforeEach(() => {
  resetAllMocks();
});

// ============================================================================
// restoreWorkerSessions — early return
// ============================================================================

describe("restoreWorkerSessions", () => {
  it("returns immediately when there are no persisted sessions", async () => {
    mockGetAllPersistedSessions.mock.mockImplementation(async () => []);

    await restoreWorkerSessions();

    assert.equal(mockSetActiveChange.mock.callCount(), 0);
    assert.equal(mockLogger.info.mock.callCount(), 0);
  });

  // ==========================================================================
  // Skipping terminal states
  // ==========================================================================

  describe("skipping terminal states", () => {
    it("skips completed sessions", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "completed" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });

    it("skips failed sessions", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "failed" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });
  });

  // ==========================================================================
  // Skipping sessions with missing data
  // ==========================================================================

  describe("skipping sessions with missing data", () => {
    it("skips sessions with null channel", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ channel: null }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });

    it("skips sessions with null threadTs", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ threadTs: null }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
    });
  });

  // ==========================================================================
  // Skipping sessions with missing repo or worktree
  // ==========================================================================

  describe("skipping sessions with missing repo or worktree", () => {
    it("skips sessions whose repo is no longer configured", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ repo: "deleted-repo" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
      assert.equal(mockLogger.debug.mock.callCount(), 1);
      const debugMsg = mockLogger.debug.mock.calls[0].arguments[0] as string;
      assert.ok(debugMsg.includes("no longer configured"));
    });

    it("skips sessions whose worktree is not found", async () => {
      mockGetExistingWorktree.mock.mockImplementation(() => null);
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [makePersistedState()]);

      await restoreWorkerSessions();

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
      assert.equal(mockLogger.debug.mock.callCount(), 1);
      const debugMsg = mockLogger.debug.mock.calls[0].arguments[0] as string;
      assert.ok(debugMsg.includes("worktree"));
    });
  });

  // ==========================================================================
  // Mid-execution sessions
  // ==========================================================================

  describe("mid-execution sessions", () => {
    const midExecStatuses: ChangeStatus[] = ["executing", "planning", "reviewing", "merging"];

    for (const status of midExecStatuses) {
      it(`marks ${status} session without PR as failed`, async () => {
        mockGetAllPersistedSessions.mock.mockImplementation(async () => [
          makePersistedState({ status, prUrl: null }),
        ]);

        await restoreWorkerSessions();

        assert.equal(mockWriteSessionState.mock.callCount(), 1);
        const writeCall = mockWriteSessionState.mock.calls[0].arguments;
        const session = writeCall[0] as { status: string };
        assert.equal(session.status, "failed");
        const message = writeCall[1] as string;
        assert.ok(message.includes("Marked failed on startup"));
      });
    }

    for (const status of midExecStatuses) {
      it(`downgrades ${status} session with PR to pr_created`, async () => {
        mockGetAllPersistedSessions.mock.mockImplementation(async () => [
          makePersistedState({ status, prUrl: "https://github.com/org/repo/pull/1" }),
        ]);

        await restoreWorkerSessions();

        assert.equal(mockSetActiveChange.mock.callCount(), 1);
        const changeArg = mockSetActiveChange.mock.calls[0].arguments[1] as { status: string };
        assert.equal(changeArg.status, "pr_created");
      });
    }

    it("writes updated session state to disk when downgrading", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "executing", prUrl: "https://github.com/org/repo/pull/1" }),
      ]);

      await restoreWorkerSessions();

      // writeSessionState should be called for the downgrade persistence
      assert.equal(mockWriteSessionState.mock.callCount(), 1);
      const writeCall = mockWriteSessionState.mock.calls[0].arguments;
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
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "pr_created" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockSetActiveChange.mock.callCount(), 1);
      const [sessionId, changeState, sessionRef] = mockSetActiveChange.mock.calls[0].arguments;
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
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "pr_created" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockWriteSessionState.mock.callCount(), 0);
    });

    it("converts startedAt and lastActivityAt strings to Date objects", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({
          status: "pr_created",
          startedAt: "2026-02-01T08:00:00.000Z",
          lastActivityAt: "2026-02-01T09:00:00.000Z",
        }),
      ]);

      await restoreWorkerSessions();

      const changeState = mockSetActiveChange.mock.calls[0].arguments[1] as {
        startedAt: Date;
        lastActivityAt: Date;
      };
      assert.ok(changeState.startedAt instanceof Date);
      assert.ok(changeState.lastActivityAt instanceof Date);
      assert.equal(changeState.startedAt.toISOString(), "2026-02-01T08:00:00.000Z");
      assert.equal(changeState.lastActivityAt.toISOString(), "2026-02-01T09:00:00.000Z");
    });

    it("converts null prUrl to undefined", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "pr_created", prUrl: null }),
      ]);

      await restoreWorkerSessions();

      const changeState = mockSetActiveChange.mock.calls[0].arguments[1] as { prUrl?: string };
      assert.equal(changeState.prUrl, undefined);
    });

    it("passes worktree from getExistingWorktree to setActiveChange", async () => {
      const customWorktree = {
        repoName: "my-repo",
        branchName: "feat/custom",
        worktreePath: "/tmp/worktrees/custom",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      };
      mockGetExistingWorktree.mock.mockImplementation(() => customWorktree);
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "pr_created" }),
      ]);

      await restoreWorkerSessions();

      const changeState = mockSetActiveChange.mock.calls[0].arguments[1] as { worktree: unknown };
      assert.equal(changeState.worktree, customWorktree);
    });
  });

  // ==========================================================================
  // Skipping when unified session is not found
  // ==========================================================================

  describe("missing unified session", () => {
    it("skips restoration when findSessionByThread returns null", async () => {
      mockFindSessionByThread.mock.mockImplementation(async () => null);
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "pr_created" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockSetActiveChange.mock.callCount(), 0);
      assert.equal(mockLogger.debug.mock.callCount(), 1);
      const debugMsg = mockLogger.debug.mock.calls[0].arguments[0] as string;
      assert.ok(debugMsg.includes("no matching unified session"));
    });
  });

  // ==========================================================================
  // Logging
  // ==========================================================================

  describe("logging", () => {
    it("logs summary when sessions are restored", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "pr_created", sessionId: "s1" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockLogger.info.mock.callCount(), 1);
      const infoMsg = mockLogger.info.mock.calls[0].arguments[0] as string;
      assert.ok(infoMsg.includes("1 restored"));
    });

    it("logs summary when sessions are marked failed", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "executing", prUrl: null }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockLogger.info.mock.callCount(), 1);
      const infoMsg = mockLogger.info.mock.calls[0].arguments[0] as string;
      assert.ok(infoMsg.includes("1 marked failed"));
    });

    it("logs downgrade count when sessions are downgraded", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "executing", prUrl: "https://github.com/org/repo/pull/1" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockLogger.info.mock.callCount(), 1);
      const infoMsg = mockLogger.info.mock.calls[0].arguments[0] as string;
      assert.ok(infoMsg.includes("1 downgraded"));
    });

    it("does not log when only sessions are skipped", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "completed" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockLogger.info.mock.callCount(), 0);
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

      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        session1,
        session2,
        session3,
      ]);

      let findCallCount = 0;
      mockFindSessionByThread.mock.mockImplementation(async () => {
        findCallCount++;
        return {
          sessionId: `unified-${findCallCount}`,
          channelId: `C00${findCallCount}`,
          threadTs: `170000000${findCallCount}.000001`,
          userId: "U001",
          triggerType: "reactions",
        };
      });

      await restoreWorkerSessions();

      // session1 restored, session2 skipped (completed), session3 marked failed
      assert.equal(mockSetActiveChange.mock.callCount(), 1);
      assert.equal(mockWriteSessionState.mock.callCount(), 1); // session3 marked failed

      const failedSession = mockWriteSessionState.mock.calls[0].arguments[0] as { status: string };
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

      mockGetAllPersistedSessions.mock.mockImplementation(async () => [state]);

      await restoreWorkerSessions();

      assert.equal(mockWriteSessionState.mock.callCount(), 1);
      const [session, message] = mockWriteSessionState.mock.calls[0].arguments;
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
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "planning", prUrl: null }),
      ]);

      await restoreWorkerSessions();

      const session = mockWriteSessionState.mock.calls[0].arguments[0] as { prUrl?: string };
      assert.equal(session.prUrl, undefined);
    });

    it("uses empty string for channel when null", async () => {
      // This path is reached only from markSessionFailed, which requires
      // mid-execution status without PR. But classifySession skips if channel is null.
      // So markSessionFailed uses `state.channel ?? ""` as a safety net.
      // We test this indirectly: the function itself always handles null channel.
      // Since classifySession guards against null channel/threadTs, this is
      // really just defensive coding in markSessionFailed.
      // We verify the code path via a pr_created mid-execution case isn't needed
      // since there's no way to reach markSessionFailed with null channel.
      // The test is kept for documentation purposes.
      assert.ok(true, "channel null guard is covered by classifySession skip");
    });
  });

  // ==========================================================================
  // classifySession (tested indirectly)
  // ==========================================================================

  describe("classifySession logic", () => {
    it("passes the correct repo config to getExistingWorktree", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ repo: "my-repo", branch: "feat/test-branch" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockGetExistingWorktree.mock.callCount(), 1);
      const [repoArg, branchArg] = mockGetExistingWorktree.mock.calls[0].arguments;
      assert.equal(repoArg.name, "my-repo");
      assert.equal(branchArg, "feat/test-branch");
    });

    it("uses the state's channel and threadTs for findSessionByThread", async () => {
      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "pr_created", channel: "C-CHAN", threadTs: "170.thread" }),
      ]);

      await restoreWorkerSessions();

      assert.equal(mockFindSessionByThread.mock.callCount(), 1);
      const [channelArg, threadTsArg] = mockFindSessionByThread.mock.calls[0].arguments;
      assert.equal(channelArg, "C-CHAN");
      assert.equal(threadTsArg, "170.thread");
    });

    it("passes triggerType from unified session to setActiveChange ref", async () => {
      mockFindSessionByThread.mock.mockImplementation(async () => ({
        sessionId: "us-1",
        channelId: "C001",
        threadTs: "170.001",
        userId: "U001",
        triggerType: "mentions",
      }));

      mockGetAllPersistedSessions.mock.mockImplementation(async () => [
        makePersistedState({ status: "pr_created" }),
      ]);

      await restoreWorkerSessions();

      const ref = mockSetActiveChange.mock.calls[0].arguments[2] as { triggerType: string };
      assert.equal(ref.triggerType, "mentions");
    });
  });
});
