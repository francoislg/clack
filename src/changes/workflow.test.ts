import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { ChangeRequest, ChangePlan, ChangeStatus, ExecutionResult } from "./types.js";
import type { ActiveChangeState } from "./activeState.js";
import type { SessionContext } from "../sessions.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { RepositoryConfig } from "../config.js";

// ============================================================================
// Mock setup — all external dependencies
// ============================================================================

const mockGetConfig = mock.fn(() => ({
  repositories: [
    { name: "my-repo", url: "https://github.com/org/my-repo.git", description: "Test repo", branch: "main" },
  ],
  changesWorkflow: { enabled: true, timeoutMinutes: 10 },
  slack: { botToken: "xoxb-test", appToken: "xapp-test", signingSecret: "s" },
}));

const mockFindRepoByName = mock.fn((name: string, _config: unknown): RepositoryConfig | undefined => {
  if (name === "my-repo") {
    return { name: "my-repo", url: "https://github.com/org/my-repo.git", description: "Test repo", branch: "main" };
  }
  return undefined;
});

mock.module("../config.js", {
  namedExports: {
    getConfig: mockGetConfig,
    findRepoByName: mockFindRepoByName,
  },
});

const mockCreateWorktree = mock.fn<(repo: RepositoryConfig, branch: string) => Promise<WorktreeInfo>>();
const mockGetExistingWorktree = mock.fn<(repo: RepositoryConfig, branch: string) => WorktreeInfo | null>();

mock.module("../worktrees.js", {
  namedExports: {
    createWorktree: mockCreateWorktree,
    getExistingWorktree: mockGetExistingWorktree,
  },
});

const mockSetActiveChange = mock.fn();
const mockClearActiveChange = mock.fn();
const mockGetActiveChangeForUser = mock.fn<(userId: string) => { sessionId: string; change: ActiveChangeState } | undefined>();
const mockUpdateActiveChangeStatus = mock.fn();

const mockGetActiveChange = mock.fn<(...args: unknown[]) => unknown>();

mock.module("./activeState.js", {
  namedExports: {
    getActiveChange: mockGetActiveChange,
    setActiveChange: mockSetActiveChange,
    clearActiveChange: mockClearActiveChange,
    getActiveChangeForUser: mockGetActiveChangeForUser,
    updateActiveChangeStatus: mockUpdateActiveChangeStatus,
  },
});

const mockAppendExecutionLog = mock.fn();
const mockReadSessionState = mock.fn<(branch: string) => Promise<unknown>>();

mock.module("./persistence.js", {
  namedExports: {
    appendExecutionLog: mockAppendExecutionLog,
    readSessionState: mockReadSessionState,
  },
});

const mockExecuteChange = mock.fn<(...args: unknown[]) => Promise<ExecutionResult>>();
const mockResolveChangesInstructions = mock.fn<(repoName: string) => string>();
const mockRunClaudeInWorktree = mock.fn<(...args: unknown[]) => Promise<{ success: boolean; text: string; error?: string }>>();
const mockRunWorktreeSetup = mock.fn<(...args: unknown[]) => Promise<void>>();

mock.module("./execution.js", {
  namedExports: {
    executeChange: mockExecuteChange,
    resolveChangesInstructions: mockResolveChangesInstructions,
    runClaudeInWorktree: mockRunClaudeInWorktree,
    runWorktreeSetup: mockRunWorktreeSetup,
  },
});

const mockBuildWorkerContext = mock.fn(() => ({}));

mock.module("../tools/context.js", {
  namedExports: {
    buildWorkerContext: mockBuildWorkerContext,
  },
});

const mockBuildClackTools = mock.fn(() => ({ mcpServer: {} }));

mock.module("../tools/server.js", {
  namedExports: {
    buildClackTools: mockBuildClackTools,
  },
});

const mockFetchPRReviewContext = mock.fn<(prUrl: string) => Promise<{ ok: true; context: string } | { ok: false; error: string }>>();

mock.module("./pr.js", {
  namedExports: {
    fetchPRReviewContext: mockFetchPRReviewContext,
  },
});

const mockGetSession = mock.fn<(sessionId: string) => Promise<SessionContext | null>>();

mock.module("../sessions.js", {
  namedExports: {
    getSession: mockGetSession,
  },
});

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

mock.module("../errors.js", {
  namedExports: {
    errorMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
  },
});

// Import after mocks
const { startChangeWorkflow, handleFollowUp } = await import("./workflow.js");

// ============================================================================
// Helpers
// ============================================================================

const defaultWorktree: WorktreeInfo = {
  repoName: "my-repo",
  branchName: "feat/test-branch",
  worktreePath: "/tmp/worktrees/my-repo/feat-test-branch",
  createdAt: new Date("2026-01-15T10:00:00Z"),
};

function makeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    userId: "U001",
    message: "Fix the bug in auth module",
    triggerType: "mentions",
    channel: "C001",
    messageTs: "1700000000.000001",
    ...overrides,
  };
}

function makePlan(overrides: Partial<ChangePlan> = {}): ChangePlan {
  return {
    branchName: "feat/test-branch",
    description: "Fix the authentication bug",
    targetRepo: "my-repo",
    ...overrides,
  };
}

function makeSessionContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "session-123",
    channelId: "C001",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000001",
    userId: "U001",
    originalQuestion: "Fix the bug",
    threadContext: [],
    refinements: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeActiveChangeState(overrides: Partial<ActiveChangeState> = {}): ActiveChangeState {
  return {
    branch: "feat/test-branch",
    repo: "my-repo",
    description: "Fix the authentication bug",
    worktree: defaultWorktree,
    status: "pr_created",
    prUrl: "https://github.com/org/my-repo/pull/42",
    startedAt: new Date("2026-01-15T10:00:00Z"),
    lastActivityAt: new Date("2026-01-15T10:30:00Z"),
    ...overrides,
  };
}

function resetMocks(): void {
  mockGetConfig.mock.resetCalls();
  mockFindRepoByName.mock.resetCalls();
  mockCreateWorktree.mock.resetCalls();
  mockGetExistingWorktree.mock.resetCalls();
  mockSetActiveChange.mock.resetCalls();
  mockClearActiveChange.mock.resetCalls();
  mockGetActiveChangeForUser.mock.resetCalls();
  mockUpdateActiveChangeStatus.mock.resetCalls();
  mockAppendExecutionLog.mock.resetCalls();
  mockReadSessionState.mock.resetCalls();
  mockExecuteChange.mock.resetCalls();
  mockResolveChangesInstructions.mock.resetCalls();
  mockRunClaudeInWorktree.mock.resetCalls();
  mockRunWorktreeSetup.mock.resetCalls();
  mockBuildWorkerContext.mock.resetCalls();
  mockBuildClackTools.mock.resetCalls();
  mockFetchPRReviewContext.mock.resetCalls();
  mockGetSession.mock.resetCalls();

  // Reset default implementations
  mockGetActiveChangeForUser.mock.mockImplementation(() => undefined);
  mockGetExistingWorktree.mock.mockImplementation(() => null);
  mockCreateWorktree.mock.mockImplementation(async () => defaultWorktree);
  mockRunWorktreeSetup.mock.mockImplementation(async () => {});
  mockReadSessionState.mock.mockImplementation(async () => null);
  mockExecuteChange.mock.mockImplementation(async () => ({ success: true, summary: "Changes implemented" }));
  mockGetSession.mock.mockImplementation(async () => null);
  mockResolveChangesInstructions.mock.mockImplementation(() => "");
  mockRunClaudeInWorktree.mock.mockImplementation(async () => ({ success: true, text: "" }));
  mockFetchPRReviewContext.mock.mockImplementation(async () => ({ ok: true as const, context: "Review context" }));
  mockFindRepoByName.mock.mockImplementation((name: string) => {
    if (name === "my-repo") {
      return { name: "my-repo", url: "https://github.com/org/my-repo.git", description: "Test repo", branch: "main" };
    }
    return undefined;
  });
}

beforeEach(resetMocks);

// ============================================================================
// startChangeWorkflow
// ============================================================================

describe("startChangeWorkflow", () => {
  it("returns error when user already has an active change", async () => {
    mockGetActiveChangeForUser.mock.mockImplementation(() => ({
      sessionId: "existing-session",
      change: makeActiveChangeState(),
    }));

    const result = await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("already have an active change"));
  });

  it("returns error when target repo is not found", async () => {
    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan({ targetRepo: "nonexistent-repo" }),
      "session-123",
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("nonexistent-repo"));
    assert.ok(result.error?.includes("not found"));
  });

  it("reserves the active change slot before creating worktree", async () => {
    mockGetSession.mock.mockImplementation(async () =>
      makeSessionContext({ activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }) }) as SessionContext,
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(mockSetActiveChange.mock.callCount(), 1);
    const [sessionId, activeChange, ref] = mockSetActiveChange.mock.calls[0].arguments;
    assert.equal(sessionId, "session-123");
    assert.equal(activeChange.branch, "feat/test-branch");
    assert.equal(activeChange.repo, "my-repo");
    assert.equal(activeChange.status, "executing");
    assert.equal(ref.userId, "U001");
    assert.equal(ref.channelId, "C001");
  });

  it("creates a new worktree when none exists", async () => {
    mockGetSession.mock.mockImplementation(async () =>
      makeSessionContext({ activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }) }) as SessionContext,
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(mockCreateWorktree.mock.callCount(), 1);
    assert.equal(mockRunWorktreeSetup.mock.callCount(), 1);
  });

  it("reuses existing worktree when one exists", async () => {
    mockGetExistingWorktree.mock.mockImplementation(() => defaultWorktree);
    mockGetSession.mock.mockImplementation(async () =>
      makeSessionContext({ activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }) }) as SessionContext,
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(mockCreateWorktree.mock.callCount(), 0);
    assert.equal(mockRunWorktreeSetup.mock.callCount(), 0);
  });

  it("reads persisted session state for existing worktree resume context", async () => {
    mockGetExistingWorktree.mock.mockImplementation(() => defaultWorktree);
    mockReadSessionState.mock.mockImplementation(async () => ({
      status: "executing",
      phase: "Implementing",
      lastMessage: "Working on changes",
    }));
    mockGetSession.mock.mockImplementation(async () =>
      makeSessionContext({ activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }) }) as SessionContext,
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(mockExecuteChange.mock.callCount(), 1);
    const resumeContext = (mockExecuteChange.mock.calls[0].arguments[0] as Record<string, unknown>).resumeContext;
    assert.ok(typeof resumeContext === "string");
    assert.ok(resumeContext.includes("Implementing"));
    assert.ok(resumeContext.includes("Working on changes"));
  });

  it("provides generic resume context for existing worktree without persisted state", async () => {
    mockGetExistingWorktree.mock.mockImplementation(() => defaultWorktree);
    mockReadSessionState.mock.mockImplementation(async () => null);
    mockGetSession.mock.mockImplementation(async () =>
      makeSessionContext({ activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }) }) as SessionContext,
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    const resumeContext = (mockExecuteChange.mock.calls[0].arguments[0] as Record<string, unknown>).resumeContext;
    assert.ok(typeof resumeContext === "string");
    assert.ok(resumeContext.includes("partial changes"));
  });

  it("clears active change slot and returns error on worktree creation failure", async () => {
    mockCreateWorktree.mock.mockImplementation(async () => {
      throw new Error("disk full");
    });

    const result = await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Failed to create workspace"));
    assert.ok(result.error?.includes("disk full"));
    assert.equal(mockClearActiveChange.mock.callCount(), 1);
    assert.equal(mockClearActiveChange.mock.calls[0].arguments[0], "session-123");
  });

  it("returns error and sets status to failed on execution failure", async () => {
    mockExecuteChange.mock.mockImplementation(async () => ({
      success: false,
      error: "Compilation failed",
    }));

    const result = await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(result.success, false);
    assert.equal(result.error, "Compilation failed");
    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 1);
    assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[1], "failed");
  });

  it("handles execution exception gracefully", async () => {
    mockExecuteChange.mock.mockImplementation(async () => {
      throw new Error("Unexpected SDK crash");
    });

    const result = await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Unexpected SDK crash"));
    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 1);
  });

  it("returns success with PR URL when execution succeeds and PR is created", async () => {
    mockGetSession.mock.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/99" }),
      }) as SessionContext,
    );

    const result = await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(result.success, true);
    assert.equal(result.prUrl, "https://github.com/org/my-repo/pull/99");
    assert.equal(result.summary, "Changes implemented");
  });

  it("returns failure when execution succeeds but PR was not created", async () => {
    mockGetSession.mock.mockImplementation(async () =>
      makeSessionContext({ activeChange: makeActiveChangeState({ prUrl: undefined }) }) as SessionContext,
    );

    const result = await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("PR was not created"));
  });

  it("returns failure when session has no activeChange after execution", async () => {
    // getSession returns session without activeChange
    mockGetSession.mock.mockImplementation(async () => makeSessionContext() as SessionContext);

    const result = await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("PR was not created"));
  });

  it("returns error with default message when execution fails without specific error", async () => {
    mockExecuteChange.mock.mockImplementation(async () => ({
      success: false,
    }));

    const result = await startChangeWorkflow(makeRequest(), makePlan(), "session-123");

    assert.equal(result.success, false);
    assert.equal(result.error, "Execution failed");
  });

  it("passes onEvent callback through to executeChange", async () => {
    mockGetSession.mock.mockImplementation(async () =>
      makeSessionContext({ activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/1" }) }) as SessionContext,
    );
    const onEvent = () => {};

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", onEvent);

    const passedOnEvent = (mockExecuteChange.mock.calls[0].arguments[0] as Record<string, unknown>).onEvent;
    assert.equal(passedOnEvent, onEvent);
  });

  it("passes onEvent callback to runWorktreeSetup for new worktrees", async () => {
    mockGetSession.mock.mockImplementation(async () =>
      makeSessionContext({ activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/1" }) }) as SessionContext,
    );
    const onEvent = () => {};

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", onEvent);

    const passedOnEvent = mockRunWorktreeSetup.mock.calls[0].arguments[3];
    assert.equal(passedOnEvent, onEvent);
  });
});

// ============================================================================
// handleFollowUp
// ============================================================================

describe("handleFollowUp", () => {
  it("returns error when session has no active change", async () => {
    const session = makeSessionContext();

    const result = await handleFollowUp(session as SessionContext, "review");

    assert.equal(result.success, false);
    assert.equal(result.error, "No active change in this thread.");
  });

  it("returns error when active change has no worktree", async () => {
    const session = makeSessionContext({
      activeChange: makeActiveChangeState({ worktree: undefined }),
    });

    const result = await handleFollowUp(session as SessionContext, "review");

    assert.equal(result.success, false);
    assert.equal(result.error, "No worktree exists for this change.");
  });

  describe("status guards", () => {
    it("rejects follow-up when status is completed", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "completed" }),
      });

      const result = await handleFollowUp(session as SessionContext, "review");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("already completed"));
    });

    it("rejects follow-up when status is failed", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "failed" }),
      });

      const result = await handleFollowUp(session as SessionContext, "review");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("already failed"));
    });

    it("rejects follow-up when status is executing", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "executing" }),
      });

      const result = await handleFollowUp(session as SessionContext, "review");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("currently executing"));
    });

    it("rejects follow-up when status is reviewing", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "reviewing" }),
      });

      const result = await handleFollowUp(session as SessionContext, "review");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("currently reviewing"));
    });

    it("rejects follow-up when status is merging", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "merging" }),
      });

      const result = await handleFollowUp(session as SessionContext, "review");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("currently merging"));
    });

    it("allows follow-up when status is pr_created", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      const result = await handleFollowUp(session as SessionContext, "review");

      // Should not return a guard error — proceeds to actual execution
      assert.notEqual(result.error, "This change is already pr_created. No further actions are possible.");
    });

    it("allows follow-up when status is planning", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "planning" }),
      });

      const result = await handleFollowUp(session as SessionContext, "review");

      // Should not return a guard error — proceeds to actual execution
      assert.notEqual(result.error, "This change is already planning. No further actions are possible.");
    });
  });

  describe("review command", () => {
    it("sets status to reviewing before fetching PR context", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "review");

      assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[1], "reviewing");
    });

    it("returns error when PR review context fetch fails", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockFetchPRReviewContext.mock.mockImplementation(async () => ({
        ok: false as const,
        error: "PR not found",
      }));

      const result = await handleFollowUp(session as SessionContext, "review");

      assert.equal(result.success, false);
      assert.equal(result.error, "PR not found");
    });

    it("runs Claude in worktree with review prompt", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "review");

      assert.equal(mockRunClaudeInWorktree.mock.callCount(), 1);
      const [repoName, options] = mockRunClaudeInWorktree.mock.calls[0].arguments;
      assert.equal(repoName, "my-repo");
      assert.ok((options as { prompt: string }).prompt.includes("Address the feedback"));
    });

    it("sets status back to pr_created after successful review", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      const result = await handleFollowUp(session as SessionContext, "review");

      assert.equal(result.success, true);
      assert.equal(result.summary, "Review feedback addressed");
      // First call sets "reviewing", second sets "pr_created"
      assert.equal(mockUpdateActiveChangeStatus.mock.calls[1].arguments[1], "pr_created");
    });

    it("returns error on review failure", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockRunClaudeInWorktree.mock.mockImplementation(async () => ({
        success: false,
        text: "",
        error: "Claude failed",
      }));

      const result = await handleFollowUp(session as SessionContext, "review");

      assert.equal(result.success, false);
      assert.equal(result.error, "Claude failed");
    });

    it("includes repo changes instructions in review system prompt when available", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockResolveChangesInstructions.mock.mockImplementation(() => "Always run lint before pushing");

      await handleFollowUp(session as SessionContext, "review");

      const options = mockRunClaudeInWorktree.mock.calls[0].arguments[1] as { systemPrompt?: string };
      assert.ok(options.systemPrompt?.includes("Always run lint before pushing"));
    });

    it("does not set system prompt when no changes instructions exist", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockResolveChangesInstructions.mock.mockImplementation(() => "");

      await handleFollowUp(session as SessionContext, "review");

      const options = mockRunClaudeInWorktree.mock.calls[0].arguments[1] as { systemPrompt?: string };
      assert.equal(options.systemPrompt, undefined);
    });
  });

  describe("update command", () => {
    it("sets status to executing before running update", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "update", "Add error handling");

      assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[1], "executing");
    });

    it("calls executeChange with the plan and worktree", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "update", "Add error handling");

      assert.equal(mockExecuteChange.mock.callCount(), 1);
      const plan = (mockExecuteChange.mock.calls[0].arguments[0] as Record<string, unknown>).plan as ChangePlan;
      assert.equal(plan.branchName, "feat/test-branch");
      assert.equal(plan.description, "Add error handling");
      assert.equal(plan.targetRepo, "my-repo");
    });

    it("uses active change description when no additional instructions provided", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({
          status: "pr_created",
          description: "Fix the auth bug",
        }),
      });

      await handleFollowUp(session as SessionContext, "update");

      const plan = (mockExecuteChange.mock.calls[0].arguments[0] as Record<string, unknown>).plan as ChangePlan;
      assert.equal(plan.description, "Fix the auth bug");
    });

    it("sets status back to pr_created on successful update", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      const result = await handleFollowUp(session as SessionContext, "update");

      assert.equal(result.success, true);
      assert.ok(result.prUrl);
      // Last call should set "pr_created"
      const lastCall = mockUpdateActiveChangeStatus.mock.calls[mockUpdateActiveChangeStatus.mock.callCount() - 1];
      assert.equal(lastCall.arguments[1], "pr_created");
    });

    it("reverts status to pr_created on update failure", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockExecuteChange.mock.mockImplementation(async () => ({
        success: false,
        error: "Tests failed",
      }));

      const result = await handleFollowUp(session as SessionContext, "update");

      assert.equal(result.success, false);
      assert.equal(result.error, "Tests failed");
      const lastCall = mockUpdateActiveChangeStatus.mock.calls[mockUpdateActiveChangeStatus.mock.callCount() - 1];
      assert.equal(lastCall.arguments[1], "pr_created");
    });

    it("passes onEvent callback to executeChange", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      const onEvent = () => {};

      await handleFollowUp(session as SessionContext, "update", undefined, onEvent);

      const passedOnEvent = (mockExecuteChange.mock.calls[0].arguments[0] as Record<string, unknown>).onEvent;
      assert.equal(passedOnEvent, onEvent);
    });
  });

  describe("merge command", () => {
    it("sets status to merging", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "merge");

      assert.equal(mockUpdateActiveChangeStatus.mock.calls[0].arguments[1], "merging");
    });

    it("runs Claude in worktree with merge prompt", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({
          status: "pr_created",
          prUrl: "https://github.com/org/my-repo/pull/42",
        }),
      });

      await handleFollowUp(session as SessionContext, "merge");

      assert.equal(mockRunClaudeInWorktree.mock.callCount(), 1);
      const options = mockRunClaudeInWorktree.mock.calls[0].arguments[1] as { prompt: string };
      assert.ok(options.prompt.includes("merge_pr"));
      assert.ok(options.prompt.includes("https://github.com/org/my-repo/pull/42"));
    });

    it("returns success when session shows completed status after merge", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({
          status: "pr_created",
          prUrl: "https://github.com/org/my-repo/pull/42",
        }),
      });
      mockGetSession.mock.mockImplementation(async () =>
        makeSessionContext({
          activeChange: makeActiveChangeState({ status: "completed" }),
        }) as SessionContext,
      );

      const result = await handleFollowUp(session as SessionContext, "merge");

      assert.equal(result.success, true);
      assert.equal(result.summary, "PR merged successfully");
    });

    it("returns success when session has no activeChange after merge (cleaned up)", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockGetSession.mock.mockImplementation(async () =>
        makeSessionContext({ activeChange: undefined }) as SessionContext,
      );

      const result = await handleFollowUp(session as SessionContext, "merge");

      assert.equal(result.success, true);
    });

    it("returns failure when session still has non-completed activeChange after merge", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockGetSession.mock.mockImplementation(async () =>
        makeSessionContext({
          activeChange: makeActiveChangeState({ status: "pr_created" }),
        }) as SessionContext,
      );

      const result = await handleFollowUp(session as SessionContext, "merge");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Merge failed"));
    });

    it("disallows standard coding tools during merge", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "merge");

      const options = mockRunClaudeInWorktree.mock.calls[0].arguments[1] as { disallowedTools: string[] };
      assert.ok(options.disallowedTools.includes("Read"));
      assert.ok(options.disallowedTools.includes("Write"));
      assert.ok(options.disallowedTools.includes("Bash"));
      assert.ok(options.disallowedTools.includes("Task"));
    });
  });

  describe("close command", () => {
    it("runs Claude in worktree with close prompt", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({
          status: "pr_created",
          prUrl: "https://github.com/org/my-repo/pull/42",
        }),
      });

      await handleFollowUp(session as SessionContext, "close");

      const options = mockRunClaudeInWorktree.mock.calls[0].arguments[1] as { prompt: string };
      assert.ok(options.prompt.includes("close_pr"));
      assert.ok(options.prompt.includes("https://github.com/org/my-repo/pull/42"));
    });

    it("returns success when session shows completed status after close", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockGetSession.mock.mockImplementation(async () =>
        makeSessionContext({
          activeChange: makeActiveChangeState({ status: "completed" }),
        }) as SessionContext,
      );

      const result = await handleFollowUp(session as SessionContext, "close");

      assert.equal(result.success, true);
      assert.equal(result.summary, "PR closed");
    });

    it("returns failure when close did not succeed", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockGetSession.mock.mockImplementation(async () =>
        makeSessionContext({
          activeChange: makeActiveChangeState({ status: "pr_created" }),
        }) as SessionContext,
      );

      const result = await handleFollowUp(session as SessionContext, "close");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Close failed"));
    });

    it("includes delete_branch in prompt when additional instructions request it", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "close", "Please delete the remote branch");

      const options = mockRunClaudeInWorktree.mock.calls[0].arguments[1] as { prompt: string };
      assert.ok(options.prompt.includes("delete_branch: true"));
    });

    it("does not include delete_branch when not requested", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "close", "Just close it");

      const options = mockRunClaudeInWorktree.mock.calls[0].arguments[1] as { prompt: string };
      assert.ok(!options.prompt.includes("delete_branch: true"));
    });

    it("does not include delete_branch when no additional instructions", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "close");

      const options = mockRunClaudeInWorktree.mock.calls[0].arguments[1] as { prompt: string };
      assert.ok(!options.prompt.includes("delete_branch: true"));
    });
  });

  describe("common behavior", () => {
    it("updates lastActivityAt on the active change", async () => {
      const activeChange = makeActiveChangeState({ status: "pr_created" });
      const before = new Date();
      const session = makeSessionContext({ activeChange });

      await handleFollowUp(session as SessionContext, "review");

      const after = new Date();
      assert.ok(activeChange.lastActivityAt >= before);
      assert.ok(activeChange.lastActivityAt <= after);
    });

    it("builds worker context with correct parameters", async () => {
      const session = makeSessionContext({
        sessionId: "session-456",
        channelId: "C999",
        threadTs: "1700000000.999999",
        activeChange: makeActiveChangeState({
          status: "pr_created",
          branch: "feat/my-feature",
          repo: "my-repo",
        }),
      });

      await handleFollowUp(session as SessionContext, "review");

      assert.equal(mockBuildWorkerContext.mock.callCount(), 1);
      const params = (mockBuildWorkerContext.mock.calls[0] as unknown as { arguments: [Record<string, unknown>] }).arguments[0];
      assert.equal(params.worktreePath, defaultWorktree.worktreePath);
      assert.equal(params.branchName, "feat/my-feature");
      assert.equal(params.repoName, "my-repo");
      assert.equal(params.channelId, "C999");
      assert.equal(params.threadTs, "1700000000.999999");
      assert.equal(params.sessionId, "session-456");
    });

    it("builds clack tools from worker context", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session as SessionContext, "review");

      assert.equal(mockBuildClackTools.mock.callCount(), 1);
    });
  });
});
