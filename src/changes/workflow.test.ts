import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { ChangeRequest, ChangePlan, ExecutionResult, ChangeStatus } from "./types.js";
import type { ActiveChangeState } from "./activeState.js";
import type { SessionContext } from "../sessions.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { RepositoryConfig, Config as AppConfig } from "../config.js";
import type { StreamEvent } from "../streaming/types.js";
import type { WorkerToolContext, ClackWorkerToolsResult } from "../tools/types.js";
import type { ExecuteChangeOptions } from "./execution.js";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { startChangeWorkflow, handleFollowUp, type WorkflowDeps } from "./workflow.js";
import type { ReleaseReason, Worker, WorkerPool } from "../workers/types.js";

function buildMockPool(): WorkerPool {
  return {
    acquire: async (repo, branch, sessionId) => {
      const existing = mockGetExistingWorktree(repo, branch);
      const info = existing ?? (await mockCreateWorktree(repo, branch));
      const worker: Worker = {
        id: branch.replace(/\//g, "-"),
        repo: repo.name,
        worktreePath: info.worktreePath,
        currentBranch: branch,
        status: "busy",
        setupComplete: existing !== null,
        setupVersionHash: null,
        claimedBy: sessionId,
        lastUsedAt: new Date(),
        createdAt: info.createdAt,
      };
      return worker;
    },
    release: async (_worker: Worker, _reason: ReleaseReason) => {},
    findByBranch: (repoName, branch) => {
      const repo = mockFindRepoByName(repoName, mockGetConfig());
      if (!repo) return null;
      const existing = mockGetExistingWorktree(repo, branch);
      if (!existing) return null;
      return {
        id: branch.replace(/\//g, "-"),
        repo: repoName,
        worktreePath: existing.worktreePath,
        currentBranch: branch,
        status: "idle",
        setupComplete: true,
        setupVersionHash: null,
        claimedBy: null,
        lastUsedAt: new Date(),
        createdAt: existing.createdAt,
      };
    },
    list: () => [],
    ensureMinimum: async () => {},
  };
}

// ============================================================================
// Mock Functions
// ============================================================================

const mockGetConfig = vi.fn<() => AppConfig>();
const mockFindRepoByName =
  vi.fn<(name: string, config: AppConfig) => RepositoryConfig | undefined>();
const mockCreateWorktree =
  vi.fn<(repo: RepositoryConfig, branch: string) => Promise<WorktreeInfo>>();
const mockGetExistingWorktree =
  vi.fn<(repo: RepositoryConfig, branch: string) => WorktreeInfo | null>();
const mockGetActiveChange = vi.fn<(sessionId: string) => ActiveChangeState | undefined>();

interface SetActiveChangeRef {
  userId: string;
  channelId: string;
  threadTs: string;
  triggerType: string;
}

const mockSetActiveChange =
  vi.fn<(sessionId: string, change: ActiveChangeState, ref: SetActiveChangeRef) => void>();
const mockClearActiveChange = vi.fn<(sessionId: string) => void>();
const mockGetActiveChangeForUser =
  vi.fn<(userId: string) => { sessionId: string; change: ActiveChangeState } | undefined>();
const mockCountActiveChangesForUser = vi.fn<(userId: string) => number>();
const mockUpdateActiveChangeStatus = vi.fn<(sessionId: string, status: ChangeStatus) => void>();
const mockAppendExecutionLog = vi.fn<(branch: string, message: string) => void>();
const mockReadSessionState =
  vi.fn<
    (branch: string) => Promise<{ status: string; phase: string; lastMessage: string } | null>
  >();
const mockExecuteChange = vi.fn<(opts: ExecuteChangeOptions) => Promise<ExecutionResult>>();
const mockResolveChangesInstructions = vi.fn<(repoName: string) => string>();

interface RunClaudeInWorktreeOpts {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  allowedTools: string[];
  disallowedTools: string[];
  branchName: string;
  mcpServers: { clack: object };
  onEvent?: (event: StreamEvent) => void | Promise<void>;
  abortController?: AbortController;
  timeout?: number;
  resumeSessionId?: string;
  onSessionId?: (id: string) => void;
}

const mockRunClaudeInWorktree =
  vi.fn<
    (
      repoName: string,
      opts: RunClaudeInWorktreeOpts,
    ) => Promise<{ success: boolean; error?: string }>
  >();
const mockRunWorktreeSetup =
  vi.fn<
    (
      repoName: string,
      worktreePath: string,
      branch: string,
      onEvent?: (event: StreamEvent) => void | Promise<void>,
    ) => Promise<void>
  >();

interface WorkerContextParams {
  worktreePath: string;
  branchName: string;
  repoName: string;
  repoUrl: string;
  channelId: string;
  threadTs: string;
  sessionId: string;
  config: AppConfig;
}

const mockBuildWorkerContext = vi.fn<(params: WorkerContextParams) => WorkerToolContext>();
const mockBuildClackTools = vi.fn<(context: WorkerToolContext) => ClackWorkerToolsResult>();
const mockFetchPRReviewContext =
  vi.fn<(prUrl: string) => Promise<{ ok: true; context: string } | { ok: false; error: string }>>();
const mockGetSession = vi.fn<(sessionId: string) => Promise<SessionContext | null>>();
const mockForceResetBranch =
  vi.fn<(worker: Worker, repo: RepositoryConfig, branch: string) => Promise<void>>();
const mockApplySlicePatch = vi.fn<(worktreePath: string, patchPath: string) => Promise<void>>(
  async () => {},
);

// Types for test assertions
type ExecuteChangeCallArg = Omit<ExecuteChangeOptions, "plan"> & {
  plan?: ChangePlan;
};

interface RunClaudeCallArg {
  prompt: string;
  systemPrompt?: string;
  disallowedTools?: string[];
}

// ============================================================================
// Dependency Factory
// ============================================================================

function makeDeps(): WorkflowDeps {
  return {
    getConfig: mockGetConfig,
    findRepoByName: mockFindRepoByName,
    pool: buildMockPool(),
    getActiveChange: mockGetActiveChange,
    setActiveChange: mockSetActiveChange,
    clearActiveChange: mockClearActiveChange,
    getActiveChangeForUser: mockGetActiveChangeForUser,
    countActiveChangesForUser: mockCountActiveChangesForUser,
    updateActiveChangeStatus: mockUpdateActiveChangeStatus,
    appendExecutionLog: mockAppendExecutionLog,
    readSessionState: mockReadSessionState,
    executeChange: mockExecuteChange,
    resolveChangesInstructions: mockResolveChangesInstructions,
    runClaudeInWorktree: mockRunClaudeInWorktree,
    runWorktreeSetup: mockRunWorktreeSetup,
    buildWorkerContext: mockBuildWorkerContext,
    buildClackTools: mockBuildClackTools,
    fetchPRReviewContext: mockFetchPRReviewContext,
    getSession: mockGetSession,
    forceResetBranch: mockForceResetBranch,
    applySlicePatch: mockApplySlicePatch,
  };
}

// ============================================================================
// Helpers
// ============================================================================

const testConfig: AppConfig = {
  repositories: [
    {
      name: "my-repo",
      url: "https://github.com/org/my-repo.git",
      description: "Test repo",
      branch: "main",
    },
  ],
  changesWorkflow: { enabled: true, timeoutMinutes: 10 },
  slack: { botToken: "xoxb-test", appToken: "xapp-test", signingSecret: "s" },
} as AppConfig;

const testRepo: RepositoryConfig = {
  name: "my-repo",
  url: "https://github.com/org/my-repo.git",
  description: "Test repo",
  branch: "main",
} as RepositoryConfig;

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
    trigger: {
      type: "mentions",
      userId: "U001",
      messageTs: "1700000000.000001",
      messageText: "Fix the bug",
    },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  } as SessionContext;
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
  } as ActiveChangeState;
}

function resetMocks(): void {
  mockGetConfig.mockClear();
  mockFindRepoByName.mockClear();
  mockCreateWorktree.mockClear();
  mockGetExistingWorktree.mockClear();
  mockGetActiveChange.mockClear();
  mockSetActiveChange.mockClear();
  mockClearActiveChange.mockClear();
  mockGetActiveChangeForUser.mockClear();
  mockCountActiveChangesForUser.mockClear();
  mockUpdateActiveChangeStatus.mockClear();
  mockAppendExecutionLog.mockClear();
  mockReadSessionState.mockClear();
  mockExecuteChange.mockClear();
  mockResolveChangesInstructions.mockClear();
  mockRunClaudeInWorktree.mockClear();
  mockRunWorktreeSetup.mockClear();
  mockBuildWorkerContext.mockClear();
  mockBuildClackTools.mockClear();
  mockFetchPRReviewContext.mockClear();
  mockGetSession.mockClear();
  mockForceResetBranch.mockClear();

  // Reset default implementations
  mockForceResetBranch.mockImplementation(async () => {});
  mockGetConfig.mockImplementation(() => testConfig);
  mockGetActiveChangeForUser.mockImplementation(() => undefined);
  mockCountActiveChangesForUser.mockImplementation(() => 0);
  mockGetExistingWorktree.mockImplementation(() => null);
  mockCreateWorktree.mockImplementation(async () => defaultWorktree);
  mockRunWorktreeSetup.mockImplementation(async () => {});
  mockReadSessionState.mockImplementation(async () => null);
  mockExecuteChange.mockImplementation(async () => ({
    success: true,
    summary: "Changes implemented",
  }));
  mockGetSession.mockImplementation(async () => null);
  mockResolveChangesInstructions.mockImplementation(() => "");
  mockRunClaudeInWorktree.mockImplementation(async () => ({ success: true }));
  mockFetchPRReviewContext.mockImplementation(async () => ({
    ok: true as const,
    context: "Review context",
  }));
  mockFindRepoByName.mockImplementation((name: string) => {
    if (name === "my-repo") {
      return testRepo;
    }
    return undefined;
  });
  mockBuildWorkerContext.mockImplementation(() => ({}) as WorkerToolContext);
  mockBuildClackTools.mockImplementation(() => ({
    mcpServer: createSdkMcpServer({ name: "test" }),
    toolNames: [],
    getResult: () => null,
    getRenderedBlocks: () => null,
    getStagedIntents: () => new Map(),
    getToolCallHistory: () => [],
    isSkipped: () => false,
    getAttentionLevel: () => null,
    getDeliveryMode: () => null,
    isPostedTopLevel: () => false,
  }));
}

beforeEach(resetMocks);

// ============================================================================
// startChangeWorkflow
// ============================================================================

describe("startChangeWorkflow", () => {
  function configWithCap(cap: number): AppConfig {
    const cw = { enabled: true, ...testConfig.changesWorkflow, maxActiveChangesPerUser: cap };
    const updated: AppConfig = { ...testConfig, changesWorkflow: cw };
    return updated;
  }

  it("returns error when user already has an active change (default cap = 1)", async () => {
    mockCountActiveChangesForUser.mockImplementation(() => 1);

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("already have an active change"));
  });

  it("allows multiple changes up to configured maxActiveChangesPerUser", async () => {
    mockGetConfig.mockImplementation(() => configWithCap(3));
    mockCountActiveChangesForUser.mockImplementation(() => 2);

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    // 2 < 3 → the gate must NOT block. We don't assert success here because the
    // post-gate happy path requires deeper mocking (executeChange, getSession,
    // pr creation). What matters is that the gate-specific error is absent.
    assert.equal(mockSetActiveChange.mock.calls.length, 1, "should reserve a slot past the gate");
    assert.ok(
      !result.error?.includes("already have"),
      `gate should not block; got: ${result.error}`,
    );
  });

  it("blocks when at the configured maxActiveChangesPerUser limit (>1)", async () => {
    mockGetConfig.mockImplementation(() => configWithCap(3));
    mockCountActiveChangesForUser.mockImplementation(() => 3);

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("limit 3"));
    assert.ok(result.error?.includes("3 active change request"));
  });

  it("disables the per-user cap when maxActiveChangesPerUser=0", async () => {
    mockGetConfig.mockImplementation(() => configWithCap(0));
    // Even with 50 in-flight, the gate should not block when cap is 0
    mockCountActiveChangesForUser.mockImplementation(() => 50);

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(
      mockCountActiveChangesForUser.mock.calls.length,
      0,
      "count helper should not be called when cap is 0",
    );
    assert.ok(
      !result.error?.includes("already have"),
      `gate should not block; got: ${result.error}`,
    );
    assert.equal(mockSetActiveChange.mock.calls.length, 1, "should reserve a slot past the gate");
  });

  it("returns error when target repo is not found", async () => {
    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan({ targetRepo: "nonexistent-repo" }),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("nonexistent-repo"));
    assert.ok(result.error?.includes("not found"));
  });

  it("reserves the active change slot before creating worktree", async () => {
    mockGetSession.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }),
      }),
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", undefined, makeDeps());

    assert.equal(mockSetActiveChange.mock.calls.length, 1);
    const [sessionId, activeChange, ref] = mockSetActiveChange.mock.calls[0];
    assert.equal(sessionId, "session-123");
    assert.equal(activeChange.branch, "feat/test-branch");
    assert.equal(activeChange.repo, "my-repo");
    assert.equal(activeChange.status, "executing");
    assert.equal(ref.userId, "U001");
    assert.equal(ref.channelId, "C001");
  });

  it("creates a new worktree when none exists", async () => {
    mockGetSession.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }),
      }),
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", undefined, makeDeps());

    assert.equal(mockCreateWorktree.mock.calls.length, 1);
    assert.equal(mockRunWorktreeSetup.mock.calls.length, 1);
  });

  it("reuses existing worktree when one exists", async () => {
    mockGetExistingWorktree.mockImplementation(() => defaultWorktree);
    mockGetSession.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }),
      }),
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", undefined, makeDeps());

    assert.equal(mockCreateWorktree.mock.calls.length, 0);
    assert.equal(mockRunWorktreeSetup.mock.calls.length, 0);
  });

  it("reads persisted session state for existing worktree resume context", async () => {
    mockGetExistingWorktree.mockImplementation(() => defaultWorktree);
    mockReadSessionState.mockImplementation(async () => ({
      status: "executing",
      phase: "Implementing",
      lastMessage: "Working on changes",
    }));
    mockGetSession.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }),
      }),
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", undefined, makeDeps());

    assert.equal(mockExecuteChange.mock.calls.length, 1);
    const arg = mockExecuteChange.mock.calls[0][0] as ExecuteChangeCallArg;
    const resumeContext = arg.resumeContext;
    assert.ok(typeof resumeContext === "string");
    assert.ok(resumeContext.includes("Implementing"));
    assert.ok(resumeContext.includes("Working on changes"));
  });

  it("provides generic resume context for existing worktree without persisted state", async () => {
    mockGetExistingWorktree.mockImplementation(() => defaultWorktree);
    mockReadSessionState.mockImplementation(async () => null);
    mockGetSession.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/42" }),
      }),
    );

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", undefined, makeDeps());

    const arg = mockExecuteChange.mock.calls[0][0] as ExecuteChangeCallArg;
    const resumeContext = arg.resumeContext;
    assert.ok(typeof resumeContext === "string");
    assert.ok(resumeContext.includes("partial changes"));
  });

  it("clears active change slot and returns error on worktree creation failure", async () => {
    mockCreateWorktree.mockImplementation(async () => {
      throw new Error("disk full");
    });

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Failed to create workspace"));
    assert.ok(result.error?.includes("disk full"));
    assert.equal(mockClearActiveChange.mock.calls.length, 1);
    assert.equal(mockClearActiveChange.mock.calls[0][0], "session-123");
  });

  it("returns error and sets status to failed on execution failure", async () => {
    mockExecuteChange.mockImplementation(async () => ({
      success: false,
      error: "Compilation failed",
    }));

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, false);
    assert.equal(result.error, "Compilation failed");
    assert.equal(mockUpdateActiveChangeStatus.mock.calls.length, 1);
    assert.equal(mockUpdateActiveChangeStatus.mock.calls[0][1], "failed");
  });

  it("handles execution exception gracefully", async () => {
    mockExecuteChange.mockImplementation(async () => {
      throw new Error("Unexpected SDK crash");
    });

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Unexpected SDK crash"));
    assert.equal(mockUpdateActiveChangeStatus.mock.calls.length, 1);
  });

  it("returns success with PR URL when execution succeeds and PR is created", async () => {
    mockGetSession.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/99" }),
      }),
    );

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, true);
    assert.equal(result.prUrl, "https://github.com/org/my-repo/pull/99");
    assert.equal(result.summary, "Changes implemented");
  });

  it("returns failure when execution succeeds but PR was not created", async () => {
    mockGetSession.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: undefined }),
      }),
    );

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("PR was not created"));
  });

  it("returns failure when session has no activeChange after execution", async () => {
    // getSession returns session without activeChange
    mockGetSession.mockImplementation(async () => makeSessionContext());

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("PR was not created"));
  });

  it("returns error with default message when execution fails without specific error", async () => {
    mockExecuteChange.mockImplementation(async () => ({
      success: false,
    }));

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      makeDeps(),
    );

    assert.equal(result.success, false);
    assert.equal(result.error, "Execution failed");
  });

  it("passes onEvent callback through to executeChange", async () => {
    mockGetSession.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/1" }),
      }),
    );
    const onEvent = () => {};

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", onEvent, makeDeps());

    const arg = mockExecuteChange.mock.calls[0][0] as ExecuteChangeCallArg;
    const passedOnEvent = arg.onEvent;
    assert.equal(passedOnEvent, onEvent);
  });

  it("passes onEvent callback to runWorktreeSetup for new worktrees", async () => {
    mockGetSession.mockImplementation(async () =>
      makeSessionContext({
        activeChange: makeActiveChangeState({ prUrl: "https://github.com/org/my-repo/pull/1" }),
      }),
    );
    const onEvent = () => {};

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", onEvent, makeDeps());

    const passedOnEvent = mockRunWorktreeSetup.mock.calls[0][3];
    assert.equal(passedOnEvent, onEvent);
  });

  function makeWorkerFor(branch: string, sessionId: string, worktree: WorktreeInfo): Worker {
    return {
      id: branch.replace(/\//g, "-"),
      repo: "my-repo",
      worktreePath: worktree.worktreePath,
      currentBranch: branch,
      status: "busy",
      setupComplete: false,
      setupVersionHash: null,
      claimedBy: sessionId,
      lastUsedAt: new Date(),
      createdAt: worktree.createdAt,
    };
  }

  it("marks the change as waiting while queued, then clears it once acquired", async () => {
    const deps = makeDeps();
    let waitingWhileQueued: boolean | undefined;
    deps.pool = {
      ...deps.pool,
      acquire: async (repo, branch, sessionId, options) => {
        options?.onQueued?.(1);
        const registered = mockSetActiveChange.mock.calls.at(-1)?.[1];
        waitingWhileQueued = registered?.waiting != null;
        return makeWorkerFor(branch, sessionId, await mockCreateWorktree(repo, branch));
      },
    };

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", undefined, deps);

    assert.equal(waitingWhileQueued, true);
    const registered = mockSetActiveChange.mock.calls.at(-1)?.[1];
    assert.equal(registered?.waiting, undefined);
  });

  it("never marks waiting when a worker is handed out immediately (no onQueued)", async () => {
    const deps = makeDeps();
    let waitingDuringAcquire: boolean | undefined;
    deps.pool = {
      ...deps.pool,
      acquire: async (repo, branch, sessionId) => {
        const registered = mockSetActiveChange.mock.calls.at(-1)?.[1];
        waitingDuringAcquire = registered?.waiting != null;
        return makeWorkerFor(branch, sessionId, await mockCreateWorktree(repo, branch));
      },
    };

    await startChangeWorkflow(makeRequest(), makePlan(), "session-123", undefined, deps);

    assert.equal(waitingDuringAcquire, false);
  });

  it("clears the change (and its waiting marker) when acquire rejects", async () => {
    const deps = makeDeps();
    deps.pool = {
      ...deps.pool,
      acquire: async (_repo, _branch, _sessionId, options) => {
        options?.onQueued?.(1);
        throw new Error("pool boom");
      },
    };

    const result = await startChangeWorkflow(
      makeRequest(),
      makePlan(),
      "session-123",
      undefined,
      deps,
    );

    assert.equal(result.success, false);
    assert.ok(mockClearActiveChange.mock.calls.some((c) => c[0] === "session-123"));
  });
});

// ============================================================================
// handleFollowUp
// ============================================================================

describe("handleFollowUp", () => {
  it("returns error when session has no active change", async () => {
    const session = makeSessionContext();

    const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

    assert.equal(result.success, false);
    assert.equal(result.error, "No active change in this thread.");
  });

  it("returns error when active change has no worktree", async () => {
    const session = makeSessionContext({
      activeChange: makeActiveChangeState({ worktree: undefined }),
    });

    const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

    assert.equal(result.success, false);
    assert.equal(result.error, "No worktree exists for this change.");
  });

  describe("status guards", () => {
    it("rejects follow-up when status is completed", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "completed" }),
      });

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("already completed"));
    });

    it("rejects non-recovery follow-up when status is failed, naming the recovery options", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "failed" }),
      });

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("This change failed"));
      assert.ok(result.error?.includes("Continue"));
      assert.ok(result.error?.includes("Start over"));
      assert.ok(result.error?.includes("Discard"));
    });

    it("rejects recovery commands when status is completed or cancelled", async () => {
      for (const status of ["completed", "cancelled"] as const) {
        for (const command of ["continue", "restart", "discard"] as const) {
          const session = makeSessionContext({
            activeChange: makeActiveChangeState({ status }),
          });

          const result = await handleFollowUp(session, command, undefined, undefined, makeDeps());

          assert.equal(result.success, false);
          assert.ok(result.error?.includes(`already ${status}`));
        }
      }
    });

    it("rejects recovery commands while a run is in flight", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "executing" }),
      });

      const result = await handleFollowUp(session, "restart", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("currently executing"));
    });

    it("rejects recovery commands when the change has not failed", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      const result = await handleFollowUp(session, "continue", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("only apply to a failed change"));
    });

    it("rejects follow-up when status is executing", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "executing" }),
      });

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("currently executing"));
    });

    it("rejects follow-up when status is reviewing", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "reviewing" }),
      });

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("currently reviewing"));
    });

    it("rejects follow-up when status is merging", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "merging" }),
      });

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("currently merging"));
    });

    it("allows follow-up when status is pr_created", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      // Should not return a guard error — proceeds to actual execution
      assert.notEqual(
        result.error,
        "This change is already pr_created. No further actions are possible.",
      );
    });

    it("allows follow-up when status is planning", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "planning" }),
      });

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      // Should not return a guard error — proceeds to actual execution
      assert.notEqual(
        result.error,
        "This change is already planning. No further actions are possible.",
      );
    });
  });

  describe("review command", () => {
    it("sets status to reviewing before fetching PR context", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(mockUpdateActiveChangeStatus.mock.calls[0][1], "reviewing");
    });

    it("returns error when PR review context fetch fails", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockFetchPRReviewContext.mockImplementation(async () => ({
        ok: false as const,
        error: "PR not found",
      }));

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.equal(result.error, "PR not found");
    });

    it("runs Claude in worktree with review prompt", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(mockRunClaudeInWorktree.mock.calls.length, 1);
      const [repoName, options] = mockRunClaudeInWorktree.mock.calls[0];
      assert.equal(repoName, "my-repo");
      assert.ok(options.prompt.includes("Address the feedback"));
    });

    it("sets status back to pr_created after successful review", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(result.success, true);
      assert.equal(result.summary, "Review feedback addressed");
      // First call sets "reviewing", second sets "pr_created"
      assert.equal(mockUpdateActiveChangeStatus.mock.calls[1][1], "pr_created");
    });

    it("returns error on review failure", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockRunClaudeInWorktree.mockImplementation(async () => ({
        success: false,
        error: "Claude failed",
      }));

      const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.equal(result.error, "Claude failed");
    });

    it("includes repo changes instructions in review system prompt when available", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockResolveChangesInstructions.mockImplementation(() => "Always run lint before pushing");

      await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      const [, options] = mockRunClaudeInWorktree.mock.calls[0];
      const callArg = options as RunClaudeCallArg;
      assert.ok(callArg.systemPrompt?.includes("Always run lint before pushing"));
    });

    it("does not set system prompt when no changes instructions exist", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockResolveChangesInstructions.mockImplementation(() => "");

      await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      const [, options] = mockRunClaudeInWorktree.mock.calls[0];
      const callArg = options as RunClaudeCallArg;
      assert.equal(callArg.systemPrompt, undefined);
    });
  });

  describe("update command", () => {
    it("sets status to executing before running update", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session, "update", "Add error handling", undefined, makeDeps());

      assert.equal(mockUpdateActiveChangeStatus.mock.calls[0][1], "executing");
    });

    it("calls executeChange with the plan and worktree", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session, "update", "Add error handling", undefined, makeDeps());

      assert.equal(mockExecuteChange.mock.calls.length, 1);
      const arg = mockExecuteChange.mock.calls[0][0] as ExecuteChangeCallArg;
      const plan = arg.plan as ChangePlan;
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

      await handleFollowUp(session, "update", undefined, undefined, makeDeps());

      const arg = mockExecuteChange.mock.calls[0][0] as ExecuteChangeCallArg;
      const plan = arg.plan as ChangePlan;
      assert.equal(plan.description, "Fix the auth bug");
    });

    it("sets status back to pr_created on successful update", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      const result = await handleFollowUp(session, "update", undefined, undefined, makeDeps());

      assert.equal(result.success, true);
      assert.ok(result.prUrl);
      // Last call should set "pr_created"
      const lastCall =
        mockUpdateActiveChangeStatus.mock.calls[mockUpdateActiveChangeStatus.mock.calls.length - 1];
      assert.equal(lastCall[1], "pr_created");
    });

    it("reverts status to pr_created on update failure", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockExecuteChange.mockImplementation(async () => ({
        success: false,
        error: "Tests failed",
      }));

      const result = await handleFollowUp(session, "update", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.equal(result.error, "Tests failed");
      const lastCall =
        mockUpdateActiveChangeStatus.mock.calls[mockUpdateActiveChangeStatus.mock.calls.length - 1];
      assert.equal(lastCall[1], "pr_created");
    });

    it("passes onEvent callback to executeChange", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      const onEvent = () => {};

      await handleFollowUp(session, "update", undefined, onEvent, makeDeps());

      const arg = mockExecuteChange.mock.calls[0][0] as ExecuteChangeCallArg;
      const passedOnEvent = arg.onEvent;
      assert.equal(passedOnEvent, onEvent);
    });

    it("returns cancelled result and reverts to pr_created when update is cancelled on an existing PR", async () => {
      // Cancellation during `update` on an existing PR should revert status to
      // pr_created (the PR still exists and the user can retry). The result
      // still carries cancelled: true so the streamer shows the cancellation banner.
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({
          status: "pr_created",
          cancelledBy: { userId: "U999", reason: "No longer needed" },
        }),
      });
      mockExecuteChange.mockImplementation(async () => ({
        success: false,
        error: "Execution aborted",
      }));

      const result = await handleFollowUp(session, "update", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.equal(result.cancelled, true);
      assert.deepEqual(result.cancelledBy, { userId: "U999", reason: "No longer needed" });
      const lastCall =
        mockUpdateActiveChangeStatus.mock.calls[mockUpdateActiveChangeStatus.mock.calls.length - 1];
      assert.equal(lastCall[1], "pr_created");
    });
  });

  describe("merge command", () => {
    it("sets status to merging", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session, "merge", undefined, undefined, makeDeps());

      assert.equal(mockUpdateActiveChangeStatus.mock.calls[0][1], "merging");
    });

    it("runs Claude in worktree with merge prompt", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({
          status: "pr_created",
          prUrl: "https://github.com/org/my-repo/pull/42",
        }),
      });

      await handleFollowUp(session, "merge", undefined, undefined, makeDeps());

      assert.equal(mockRunClaudeInWorktree.mock.calls.length, 1);
      const [, options] = mockRunClaudeInWorktree.mock.calls[0];
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
      mockGetSession.mockImplementation(async () =>
        makeSessionContext({
          activeChange: makeActiveChangeState({ status: "completed" }),
        }),
      );

      const result = await handleFollowUp(session, "merge", undefined, undefined, makeDeps());

      assert.equal(result.success, true);
      assert.equal(result.summary, "PR merged successfully");
    });

    it("returns success when session has no activeChange after merge (cleaned up)", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockGetSession.mockImplementation(async () =>
        makeSessionContext({ activeChange: undefined }),
      );

      const result = await handleFollowUp(session, "merge", undefined, undefined, makeDeps());

      assert.equal(result.success, true);
    });

    it("returns failure when session still has non-completed activeChange after merge", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockGetSession.mockImplementation(async () =>
        makeSessionContext({
          activeChange: makeActiveChangeState({ status: "pr_created" }),
        }),
      );

      const result = await handleFollowUp(session, "merge", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Merge failed"));
    });

    it("disallows standard coding tools during merge", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session, "merge", undefined, undefined, makeDeps());

      const [, options] = mockRunClaudeInWorktree.mock.calls[0];
      const callArg = options as RunClaudeCallArg;
      assert.ok(callArg.disallowedTools?.includes("Read"));
      assert.ok(callArg.disallowedTools?.includes("Write"));
      assert.ok(callArg.disallowedTools?.includes("Bash"));
      assert.ok(callArg.disallowedTools?.includes("Task"));
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

      await handleFollowUp(session, "close", undefined, undefined, makeDeps());

      const [, options] = mockRunClaudeInWorktree.mock.calls[0];
      assert.ok(options.prompt.includes("close_pr"));
      assert.ok(options.prompt.includes("https://github.com/org/my-repo/pull/42"));
    });

    it("returns success when session shows completed status after close", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockGetSession.mockImplementation(async () =>
        makeSessionContext({
          activeChange: makeActiveChangeState({ status: "completed" }),
        }),
      );

      const result = await handleFollowUp(session, "close", undefined, undefined, makeDeps());

      assert.equal(result.success, true);
      assert.equal(result.summary, "PR closed");
    });

    it("returns failure when close did not succeed", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });
      mockGetSession.mockImplementation(async () =>
        makeSessionContext({
          activeChange: makeActiveChangeState({ status: "pr_created" }),
        }),
      );

      const result = await handleFollowUp(session, "close", undefined, undefined, makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Close failed"));
    });

    it("includes delete_branch in prompt when additional instructions request it", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(
        session,
        "close",
        "Please delete the remote branch",
        undefined,
        makeDeps(),
      );

      const [, options] = mockRunClaudeInWorktree.mock.calls[0];
      assert.ok(options.prompt.includes("delete_branch: true"));
    });

    it("does not include delete_branch when not requested", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session, "close", "Just close it", undefined, makeDeps());

      const [, options] = mockRunClaudeInWorktree.mock.calls[0];
      assert.ok(!options.prompt.includes("delete_branch: true"));
    });

    it("does not include delete_branch when no additional instructions", async () => {
      const session = makeSessionContext({
        activeChange: makeActiveChangeState({ status: "pr_created" }),
      });

      await handleFollowUp(session, "close", undefined, undefined, makeDeps());

      const [, options] = mockRunClaudeInWorktree.mock.calls[0];
      assert.ok(!options.prompt.includes("delete_branch: true"));
    });
  });

  describe("recovery commands", () => {
    function failedSession(overrides: Partial<ActiveChangeState> = {}): SessionContext {
      return makeSessionContext({
        activeChange: makeActiveChangeState({ status: "failed", prUrl: undefined, ...overrides }),
      });
    }

    function depsWithPool(poolOverrides: Partial<WorkerPool>): WorkflowDeps {
      const deps = makeDeps();
      deps.pool = { ...buildMockPool(), ...poolOverrides };
      return deps;
    }

    describe("continue", () => {
      it("re-enters executing with a resume context built from the persisted state", async () => {
        mockReadSessionState.mockImplementation(async () => ({
          status: "failed",
          phase: "Implementing",
          lastMessage: "npm install exploded",
        }));
        const session = failedSession({ sdkSessionId: "sdk-1" });

        await handleFollowUp(session, "continue", undefined, undefined, makeDeps());

        assert.deepEqual(mockUpdateActiveChangeStatus.mock.calls[0].slice(0, 2), [
          "session-123",
          "executing",
        ]);
        assert.equal(mockExecuteChange.mock.calls.length, 1);
        const opts = mockExecuteChange.mock.calls[0][0];
        assert.ok(opts.resumeContext?.includes("Implementing"));
        assert.ok(opts.resumeContext?.includes("npm install exploded"));
        assert.equal(opts.sdkSessionId, "sdk-1");
      });

      it("reads the persisted state before flipping the status", async () => {
        const session = failedSession();

        await handleFollowUp(session, "continue", undefined, undefined, makeDeps());

        assert.ok(
          mockReadSessionState.mock.invocationCallOrder[0] <
            mockUpdateActiveChangeStatus.mock.invocationCallOrder[0],
        );
      });

      it("refreshes worker setup before executing", async () => {
        const refreshSetup = vi.fn<NonNullable<WorkerPool["refreshSetup"]>>(async () => {});
        const session = failedSession();

        await handleFollowUp(
          session,
          "continue",
          undefined,
          undefined,
          depsWithPool({ refreshSetup }),
        );

        assert.equal(refreshSetup.mock.calls.length, 1);
        assert.ok(
          refreshSetup.mock.invocationCallOrder[0] < mockExecuteChange.mock.invocationCallOrder[0],
        );
      });

      it("returns to failed without executing when setup refresh throws", async () => {
        const refreshSetup = vi.fn<NonNullable<WorkerPool["refreshSetup"]>>(async () => {
          throw new Error("setup script exited 1");
        });
        const session = failedSession();

        const result = await handleFollowUp(
          session,
          "continue",
          undefined,
          undefined,
          depsWithPool({ refreshSetup }),
        );

        assert.equal(result.success, false);
        assert.ok(result.error?.includes("setup script exited 1"));
        assert.equal(mockExecuteChange.mock.calls.length, 0);
        const lastStatus = mockUpdateActiveChangeStatus.mock.calls.at(-1);
        assert.equal(lastStatus?.[1], "failed");
      });

      it("returns to failed when execution fails again", async () => {
        mockExecuteChange.mockImplementation(async () => ({
          success: false,
          error: "tests are red",
        }));
        const session = failedSession();

        const result = await handleFollowUp(session, "continue", undefined, undefined, makeDeps());

        assert.equal(result.success, false);
        assert.equal(result.error, "tests are red");
        const lastStatus = mockUpdateActiveChangeStatus.mock.calls.at(-1);
        assert.equal(lastStatus?.[1], "failed");
      });

      it("succeeds when the recovered execution creates a PR", async () => {
        mockGetSession.mockImplementation(async () =>
          makeSessionContext({
            activeChange: makeActiveChangeState({
              status: "pr_created",
              prUrl: "https://github.com/org/my-repo/pull/77",
            }),
          }),
        );
        const session = failedSession();

        const result = await handleFollowUp(session, "continue", undefined, undefined, makeDeps());

        assert.equal(result.success, true);
        assert.equal(result.prUrl, "https://github.com/org/my-repo/pull/77");
      });

      it("returns to failed when execution succeeds without creating a PR", async () => {
        const session = failedSession();

        const result = await handleFollowUp(session, "continue", undefined, undefined, makeDeps());

        assert.equal(result.success, false);
        assert.ok(result.error?.includes("PR was not created"));
        const lastStatus = mockUpdateActiveChangeStatus.mock.calls.at(-1);
        assert.equal(lastStatus?.[1], "failed");
      });
    });

    describe("restart", () => {
      it("force-resets the worktree and starts a fresh run", async () => {
        const session = failedSession({ sdkSessionId: "sdk-1" });

        await handleFollowUp(session, "restart", undefined, undefined, makeDeps());

        assert.equal(mockForceResetBranch.mock.calls.length, 1);
        assert.equal(mockForceResetBranch.mock.calls[0][2], "feat/test-branch");
        assert.equal(mockExecuteChange.mock.calls.length, 1);
        const opts = mockExecuteChange.mock.calls[0][0];
        assert.equal(opts.resumeContext, undefined);
        assert.equal(opts.sdkSessionId, undefined);
        assert.equal(session.activeChange?.sdkSessionId, undefined);
      });

      it("returns to failed without executing when the reset throws", async () => {
        mockForceResetBranch.mockImplementation(async () => {
          throw new Error("git checkout failed");
        });
        const session = failedSession();

        const result = await handleFollowUp(session, "restart", undefined, undefined, makeDeps());

        assert.equal(result.success, false);
        assert.ok(result.error?.includes("git checkout failed"));
        assert.equal(mockExecuteChange.mock.calls.length, 0);
        const lastStatus = mockUpdateActiveChangeStatus.mock.calls.at(-1);
        assert.equal(lastStatus?.[1], "failed");
      });
    });

    describe("discard", () => {
      it("releases the worker as discarded and cancels the change", async () => {
        const release = vi.fn<WorkerPool["release"]>(async () => {});
        const session = failedSession();

        const result = await handleFollowUp(
          session,
          "discard",
          undefined,
          undefined,
          depsWithPool({ release }),
        );

        assert.equal(result.success, true);
        assert.equal(release.mock.calls.length, 1);
        assert.equal(release.mock.calls[0][1], "discarded");
        const lastStatus = mockUpdateActiveChangeStatus.mock.calls.at(-1);
        assert.equal(lastStatus?.[1], "cancelled");
        assert.equal(session.activeChange?.worktree, undefined);
      });

      it("cancels without releasing when no worktree is bound", async () => {
        const release = vi.fn<WorkerPool["release"]>(async () => {});
        const session = failedSession({ worktree: undefined });

        const result = await handleFollowUp(
          session,
          "discard",
          undefined,
          undefined,
          depsWithPool({ release }),
        );

        assert.equal(result.success, true);
        assert.equal(release.mock.calls.length, 0);
        const lastStatus = mockUpdateActiveChangeStatus.mock.calls.at(-1);
        assert.equal(lastStatus?.[1], "cancelled");
      });

      it("surfaces a release failure and keeps the change failed", async () => {
        const release = vi.fn<WorkerPool["release"]>(async () => {
          throw new Error("git is wedged");
        });
        const session = failedSession();

        const result = await handleFollowUp(
          session,
          "discard",
          undefined,
          undefined,
          depsWithPool({ release }),
        );

        assert.equal(result.success, false);
        assert.ok(result.error?.includes("git is wedged"));
        assert.equal(mockUpdateActiveChangeStatus.mock.calls.length, 0);
      });
    });
  });

  describe("common behavior", () => {
    it("updates lastActivityAt on the active change", async () => {
      const activeChange = makeActiveChangeState({ status: "pr_created" });
      const before = new Date();
      const session = makeSessionContext({ activeChange });

      await handleFollowUp(session, "review", undefined, undefined, makeDeps());

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

      await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(mockBuildWorkerContext.mock.calls.length, 1);
      const params = mockBuildWorkerContext.mock.calls[0][0] as WorkerContextParams;
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

      await handleFollowUp(session, "review", undefined, undefined, makeDeps());

      assert.equal(mockBuildClackTools.mock.calls.length, 1);
    });
  });
});
