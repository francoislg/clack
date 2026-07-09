import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { ChangeRequest, ChangePlan, ExecutionResult } from "./types.js";
import type { ActiveChangeState } from "./activeState.js";
import type { SessionContext } from "../sessions.js";
import type { Config as AppConfig, RepositoryConfig } from "../config.js";
import type { ReleaseReason, Worker, WorkerPool } from "../workers/types.js";
import { startChangeWorkflow, handleFollowUp, type WorkflowDeps } from "./workflow.js";
import { TesterServiceError } from "../tester/services.js";

const checkSidecarReachableMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../tester/sidecar.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tester/sidecar.js")>();
  return { ...original, checkSidecarReachable: checkSidecarReachableMock };
});

const tryAcquireTesterSlotMock = vi.hoisted(() => vi.fn(() => true));
const releaseTesterSlotMock = vi.hoisted(() => vi.fn());
vi.mock("../tester/concurrency.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tester/concurrency.js")>();
  return {
    ...original,
    tryAcquireTesterSlot: tryAcquireTesterSlotMock,
    releaseTesterSlot: releaseTesterSlotMock,
  };
});

// ============================================================================
// Fixtures
// ============================================================================

const testRepo: RepositoryConfig = {
  name: "my-repo",
  url: "https://github.com/org/my-repo.git",
  description: "Test repo",
  branch: "main",
};

const testerConfig = {
  repositories: [testRepo],
  changesWorkflow: { enabled: true, timeoutMinutes: 10 },
  tester: {
    enabled: true,
    sidecarUrl: "http://clack-playwright:8931/mcp",
    recordingsDir: "/recordings",
  },
} as AppConfig;

const testerDisabledConfig = {
  repositories: [testRepo],
  changesWorkflow: { enabled: true, timeoutMinutes: 10 },
  tester: { enabled: false },
} as AppConfig;

function makeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    userId: "U001",
    message: "Test the login flow",
    triggerType: "mentions",
    channel: "C001",
    messageTs: "1700000000.000001",
    ...overrides,
  };
}

function makeTestPlan(overrides: Partial<ChangePlan> = {}): ChangePlan {
  return {
    branchName: "feature/login",
    description: "Test the login flow",
    targetRepo: "my-repo",
    kind: "test",
    resumeRemoteBranch: true,
    ...overrides,
  };
}

interface PoolCalls {
  released: Array<{ worker: Worker; reason: ReleaseReason }>;
  acquired: number;
}

function makePool(calls: PoolCalls): WorkerPool {
  return {
    acquire: async (repo, branch, sessionId) => {
      calls.acquired += 1;
      return {
        id: "w1",
        repo: repo.name,
        worktreePath: `/tmp/worktrees/${repo.name}/w1`,
        currentBranch: branch,
        status: "busy",
        setupComplete: true,
        setupVersionHash: null,
        claimedBy: sessionId,
        lastUsedAt: new Date(),
        createdAt: new Date(),
      };
    },
    release: async (worker, reason) => {
      calls.released.push({ worker, reason });
    },
    findByBranch: () => null,
    list: () => [],
    ensureMinimum: async () => {},
  };
}

function makeDeps(overrides: Partial<WorkflowDeps> = {}): WorkflowDeps & { poolCalls: PoolCalls } {
  const poolCalls: PoolCalls = { released: [], acquired: 0 };
  const deps: WorkflowDeps = {
    getConfig: vi.fn(() => testerConfig),
    findRepoByName: vi.fn(() => testRepo),
    pool: makePool(poolCalls),
    getActiveChange: vi.fn(() => undefined),
    setActiveChange: vi.fn(),
    clearActiveChange: vi.fn(),
    getActiveChangeForUser: vi.fn(() => undefined),
    countActiveChangesForUser: vi.fn(() => 0),
    updateActiveChangeStatus: vi.fn(),
    appendExecutionLog: vi.fn(),
    readSessionState: vi.fn(async () => null),
    executeChange: vi.fn(async (): Promise<ExecutionResult> => ({ success: true, summary: "ok" })),
    resolveChangesInstructions: vi.fn(() => ""),
    runClaudeInWorktree: vi.fn(async () => ({ success: true })),
    runWorktreeSetup: vi.fn(async () => {}),
    buildWorkerContext: vi.fn(),
    buildClackTools: vi.fn(),
    fetchPRReviewContext: vi.fn(async () => ({ ok: true as const, context: "" })),
    getSession: vi.fn(async () => null),
    findActiveChangeByBranch: vi.fn(() => undefined),
    classifyChangeSession: vi.fn(() => "orphan" as const),
    adoptActiveChange: vi.fn(),
    getActiveChangeRef: vi.fn(() => undefined),
    getUserRole: vi.fn(async () => "dev" as const),
    reassignWorkerClaim: vi.fn(() => true),
    detachStaleClaimedWorker: vi.fn(async () => "detached" as const),
    forceResetBranch: vi.fn(async () => {}),
    applySlicePatch: vi.fn(async () => {}),
    getUserRecord: vi.fn(async () => null),
    loadTesterServices: vi.fn(() => ({ ok: true as const, services: null })),
    ensureTesterServices: vi.fn(async () => []),
    stopTesterServices: vi.fn(async () => {}),
    getOwnerUserId: vi.fn(async () => "UOWNER"),
    sendOwnerDm: vi.fn(async () => true),
    ...overrides,
  };
  return Object.assign(deps, { poolCalls });
}

function makeTesterActiveChange(overrides: Partial<ActiveChangeState> = {}): ActiveChangeState {
  return {
    branch: "feature/login",
    repo: "my-repo",
    description: "Test the login flow",
    kind: "test",
    status: "completed",
    startedAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

function makeSession(activeChange: ActiveChangeState): SessionContext {
  return {
    sessionId: "s1",
    channelId: "C001",
    messageTs: "1.0",
    threadTs: "1.0",
    userId: "U001",
    trigger: { type: "mentions", userId: "U001", messageTs: "1.0", messageText: "test" },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    activeChange,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("startChangeWorkflow — tester runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkSidecarReachableMock.mockResolvedValue(true);
    tryAcquireTesterSlotMock.mockReturnValue(true);
  });

  it("aborts before acquiring anything when the sidecar is unreachable", async () => {
    checkSidecarReachableMock.mockResolvedValue(false);
    const deps = makeDeps();

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("clack-playwright"));
    assert.equal(deps.poolCalls.acquired, 0);
    assert.equal(vi.mocked(deps.setActiveChange).mock.calls.length, 0);
  });

  it("rejects when the tester feature is not enabled", async () => {
    const deps = makeDeps({ getConfig: vi.fn(() => testerDisabledConfig) });

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("not enabled"));
    assert.equal(deps.poolCalls.acquired, 0);
  });

  it("rejects when the tester slot cap is reached", async () => {
    tryAcquireTesterSlotMock.mockReturnValue(false);
    const deps = makeDeps();

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("already in progress"));
    assert.equal(deps.poolCalls.acquired, 0);
  });

  it("settles a successful test terminally: worker released, slot freed, status completed", async () => {
    const deps = makeDeps();

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, true);
    assert.equal(deps.poolCalls.released.length, 1);
    assert.equal(deps.poolCalls.released[0].reason, "discarded");
    assert.deepEqual(releaseTesterSlotMock.mock.calls[0], ["s1"]);
    const updateStatus = vi.mocked(deps.updateActiveChangeStatus);
    const statuses = updateStatus.mock.calls.map(([, status]) => status);
    assert.ok(statuses.includes("completed"));
    // success must NOT depend on a prUrl appearing on the session
    assert.equal(vi.mocked(deps.getSession).mock.calls.length, 0);
  });

  it("passes the kind:'test' plan through to executeChange", async () => {
    const deps = makeDeps();

    await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    const opts = vi.mocked(deps.executeChange).mock.calls[0][0];
    assert.equal(opts.plan.kind, "test");
    assert.equal(opts.plan.resumeRemoteBranch, true);
  });

  it("settles a failed test as failed and still frees worker + slot", async () => {
    const deps = makeDeps({
      executeChange: vi.fn(
        async (): Promise<ExecutionResult> => ({
          success: false,
          error: "app never became healthy",
        }),
      ),
    });

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("app never became healthy"));
    assert.equal(deps.poolCalls.released.length, 1);
    assert.deepEqual(releaseTesterSlotMock.mock.calls[0], ["s1"]);
    const updateStatus = vi.mocked(deps.updateActiveChangeStatus);
    const statuses = updateStatus.mock.calls.map(([, status]) => status);
    assert.ok(statuses.includes("failed"));
  });

  it("frees the tester slot when workspace acquisition fails", async () => {
    const deps = makeDeps();
    deps.pool.acquire = async () => {
      throw new Error("PoolExhausted");
    };

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, false);
    assert.deepEqual(releaseTesterSlotMock.mock.calls[0], ["s1"]);
  });

  it("leaves implement runs untouched by tester gates", async () => {
    const prSession = makeSession(
      makeTesterActiveChange({ kind: undefined, prUrl: "https://github.com/org/my-repo/pull/1" }),
    );
    const deps = makeDeps({ getSession: vi.fn(async () => prSession) });

    const result = await startChangeWorkflow(
      makeRequest(),
      { branchName: "clack/feat/x", description: "d", targetRepo: "my-repo" },
      "s1",
      undefined,
      deps,
    );

    assert.equal(result.success, true);
    assert.equal(checkSidecarReachableMock.mock.calls.length, 0);
    assert.equal(tryAcquireTesterSlotMock.mock.calls.length, 0);
  });
});

describe("startChangeWorkflow — tester services", () => {
  const MYSQL_SPEC = { name: "mysql", image: "mysql:8", memoryMb: 384, port: 3306 };
  const STARTED = [
    { name: "mysql", host: "clack-svc-my-repo-mysql", port: 3306, image: "mysql:8", tmpfs: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    checkSidecarReachableMock.mockResolvedValue(true);
    tryAcquireTesterSlotMock.mockReturnValue(true);
  });

  it("provisions after the slot claim, before acquisition, and stops after the run", async () => {
    const order: string[] = [];
    tryAcquireTesterSlotMock.mockImplementation(() => {
      order.push("slot");
      return true;
    });
    const deps = makeDeps({
      loadTesterServices: vi.fn(() => ({ ok: true as const, services: [MYSQL_SPEC] })),
      ensureTesterServices: vi.fn(async () => {
        order.push("ensure");
        return STARTED;
      }),
      stopTesterServices: vi.fn(async () => {
        order.push("stop");
      }),
    });
    const poolAcquire = deps.pool.acquire;
    deps.pool.acquire = async (...args) => {
      order.push("acquire");
      return poolAcquire(...args);
    };
    releaseTesterSlotMock.mockImplementation(() => {
      order.push("release");
    });

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, true);
    assert.deepEqual(order, ["slot", "ensure", "acquire", "stop", "release"]);
  });

  it("threads the started services into executeChange", async () => {
    const deps = makeDeps({
      loadTesterServices: vi.fn(() => ({ ok: true as const, services: [MYSQL_SPEC] })),
      ensureTesterServices: vi.fn(async () => STARTED),
    });

    await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    const opts = vi.mocked(deps.executeChange).mock.calls[0][0];
    assert.deepEqual(opts.testerServices, STARTED);
  });

  it("omits testerServices from executeChange when the repo declares none", async () => {
    const deps = makeDeps();

    await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(vi.mocked(deps.ensureTesterServices).mock.calls.length, 0);
    assert.equal(vi.mocked(deps.stopTesterServices).mock.calls.length, 0);
    const opts = vi.mocked(deps.executeChange).mock.calls[0][0];
    assert.equal("testerServices" in opts, false);
  });

  it("aborts before acquisition on an invalid declaration file", async () => {
    const deps = makeDeps({
      loadTesterServices: vi.fn(() => ({
        ok: false as const,
        error: "'tester_services.services[0].port' too big",
      })),
    });

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("tester_services.json` is invalid"));
    assert.ok(result.error?.includes("port' too big"));
    assert.equal(deps.poolCalls.acquired, 0);
    assert.deepEqual(releaseTesterSlotMock.mock.calls[0], ["s1"]);
    assert.equal(vi.mocked(deps.stopTesterServices).mock.calls.length, 0);
    // Owner is alerted even for a config-class failure.
    const dmCall = vi.mocked(deps.sendOwnerDm).mock.calls[0];
    assert.equal(dmCall?.[0], "UOWNER");
    assert.ok(dmCall?.[1].includes("my-repo"));
  });

  it("aborts before acquisition when provisioning fails, without a teardown of its own", async () => {
    const deps = makeDeps({
      loadTesterServices: vi.fn(() => ({ ok: true as const, services: [MYSQL_SPEC] })),
      ensureTesterServices: vi.fn(async () => {
        throw new TesterServiceError("budget_exceeded", "need 384 MB but budget is 100");
      }),
    });

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("tester.servicesBudgetMb"));
    assert.ok(result.error?.includes("need 384 MB but budget is 100"));
    assert.equal(deps.poolCalls.acquired, 0);
    assert.deepEqual(releaseTesterSlotMock.mock.calls[0], ["s1"]);
    assert.equal(vi.mocked(deps.stopTesterServices).mock.calls.length, 0);
    const dmCall = vi.mocked(deps.sendOwnerDm).mock.calls[0];
    assert.equal(dmCall?.[0], "UOWNER");
    assert.ok(dmCall?.[1].includes("my-repo"));
  });

  it("does not DM the owner when provisioning succeeds", async () => {
    const deps = makeDeps({
      loadTesterServices: vi.fn(() => ({ ok: true as const, services: [MYSQL_SPEC] })),
      ensureTesterServices: vi.fn(async () => STARTED),
    });

    await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(vi.mocked(deps.sendOwnerDm).mock.calls.length, 0);
  });

  it("skips the owner DM when the requester is the owner", async () => {
    const deps = makeDeps({
      loadTesterServices: vi.fn(() => ({ ok: true as const, services: [MYSQL_SPEC] })),
      ensureTesterServices: vi.fn(async () => {
        throw new TesterServiceError("readiness_timeout", "mysql never became ready");
      }),
      getOwnerUserId: vi.fn(async () => "U001"),
    });

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, false);
    assert.equal(vi.mocked(deps.sendOwnerDm).mock.calls.length, 0);
  });

  it("stops services even when the execution fails", async () => {
    const deps = makeDeps({
      loadTesterServices: vi.fn(() => ({ ok: true as const, services: [MYSQL_SPEC] })),
      ensureTesterServices: vi.fn(async () => STARTED),
      executeChange: vi.fn(async (): Promise<ExecutionResult> => {
        throw new Error("boom");
      }),
    });

    const result = await startChangeWorkflow(makeRequest(), makeTestPlan(), "s1", undefined, deps);

    assert.equal(result.success, false);
    assert.equal(vi.mocked(deps.stopTesterServices).mock.calls.length, 1);
    assert.equal(vi.mocked(deps.stopTesterServices).mock.calls[0][0], "my-repo");
  });

  it("never touches the service path on implement runs", async () => {
    const deps = makeDeps();

    await startChangeWorkflow(
      makeRequest(),
      { branchName: "clack/feat/x", description: "d", targetRepo: "my-repo" },
      "s1",
      undefined,
      deps,
    );

    assert.equal(vi.mocked(deps.loadTesterServices).mock.calls.length, 0);
    assert.equal(vi.mocked(deps.stopTesterServices).mock.calls.length, 0);
  });
});

describe("handleFollowUp — tester runs are terminal", () => {
  it("refuses follow-up commands on a test change", async () => {
    const session = makeSession(makeTesterActiveChange());

    const result = await handleFollowUp(session, "review", undefined, undefined, makeDeps());

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("no follow-up actions"));
  });
});
