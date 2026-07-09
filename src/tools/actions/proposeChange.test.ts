import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { createProposeChangeTool, type ProposeChangeDeps } from "./proposeChange.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import type { RepositoryConfig } from "../../config.js";
import type { PersistedSessionState } from "../../changes/types.js";
import type { ActiveChangeState, ChangeSessionLiveness } from "../../changes/activeState.js";
import type { Worker } from "../../workers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
  return {
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    description: "Test repo",
    access: { read: "member", write: "dev" },
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<ProposeChangeDeps>): ProposeChangeDeps {
  return {
    findWorkerByBranch: vi.fn(() => null),
    readSessionState: vi.fn(async () => null),
    canWriteRepo: vi.fn(() => true),
    getWritableRepos: vi.fn(() => [makeRepo()]),
    findActiveChangeByBranch: vi.fn(() => undefined),
    classifyChangeSession: vi.fn((): ChangeSessionLiveness => "orphan"),
    getActiveChangeRef: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeWorkerOnBranch(overrides?: Partial<Worker>): Worker {
  return {
    id: "worker-1",
    repo: "my-repo",
    worktreePath: "/tmp/worktrees/my-repo/worker-1",
    currentBranch: "clack/fix/existing",
    status: "busy",
    setupComplete: true,
    setupVersionHash: null,
    claimedBy: "sess-old",
    lastUsedAt: new Date("2025-06-15T09:00:00Z"),
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeChangeOnBranch(overrides?: Partial<ActiveChangeState>): ActiveChangeState {
  return {
    branch: "clack/fix/existing",
    repo: "my-repo",
    description: "Existing change",
    status: "pr_created",
    startedAt: new Date("2025-01-01T00:00:00Z"),
    lastActivityAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePersistedState(overrides?: Partial<PersistedSessionState>): PersistedSessionState {
  return {
    sessionId: "sess-old",
    status: "executing",
    phase: "executing",
    branch: "clack/fix/existing",
    repo: "my-repo",
    userId: "U123",
    description: "Existing change",
    prUrl: null,
    startedAt: "2025-01-01T00:00:00Z",
    lastActivityAt: "2025-01-01T12:00:00Z",
    lastMessage: "working",
    channel: "C1",
    threadTs: "1.0",
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<QueryToolContext>): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "dev",
    session: {
      sessionId: "sess-1",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U123",
      trigger: { type: "mentions", userId: "U123", messageTs: "1.0", messageText: "test" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: {
      repositories: [makeRepo()],
    } as QueryToolContext["config"],
    changesWorkflowEnabled: true,
    cronUserSchedules: false,
    ...overrides,
  };
}

function makeIntentStore(): IntentStore {
  const intents = new Map<string, ReturnType<IntentStore["resolve"]>>();
  let counter = 0;
  return {
    stage: (intent) => {
      const ref = `ref-${++counter}`;
      intents.set(ref, intent as ReturnType<IntentStore["resolve"]>);
      return ref;
    },
    resolve: (ref: string) => intents.get(ref) as ReturnType<IntentStore["resolve"]>,
    getAll: () => intents as ReturnType<IntentStore["getAll"]>,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proposeChange tool", () => {
  let deps: ProposeChangeDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("rejects invalid branch name format", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "bad-branch-name",
        description: "fix a bug",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid branch name"));
    assert.equal(result.isError, true);
  });

  it("rejects branch with wrong type prefix", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/bugfix/my-change",
        description: "fix a bug",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("Invalid branch name"));
    assert.equal(result.isError, true);
  });

  it("rejects unknown repository", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/my-change",
        description: "fix something",
        repo: "nonexistent-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("my-repo")); // lists available repos
    assert.equal(result.isError, true);
  });

  it("rejects when user lacks write access", async () => {
    deps = makeDeps({
      canWriteRepo: vi.fn(() => false),
      getWritableRepos: vi.fn(() => []),
    });

    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/my-change",
        description: "fix something",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("write access"));
    assert.equal(result.isError, true);
  });

  it("shows writable repos when user lacks write access but has other repos", async () => {
    const otherRepo = makeRepo({ name: "other-repo" });
    deps = makeDeps({
      canWriteRepo: vi.fn(() => false),
      getWritableRepos: vi.fn(() => [otherRepo]),
    });

    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/my-change",
        description: "fix something",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("other-repo"));
  });

  it("stages intent and returns ref on valid input", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/feat/add-login",
        description: "Add login feature",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.ref);
    assert.equal(parsed.branch, "clack/feat/add-login");
    assert.equal(parsed.description, "Add login feature");
    assert.equal(parsed.repo, "my-repo");
    assert.equal(parsed.existingWorktree, undefined);
    assert.equal(result.isError, undefined);

    // Verify the intent was staged
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal(staged!.type, "change");
  });

  it("forwards plan into the staged intent when provided", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const detailedPlan = "1. Migrate file A using strategy X\n2. Migrate file B using strategy Y";
    const result = await toolDef.handler(
      {
        branch: "clack/feat/add-login",
        description: "Add login feature",
        repo: "my-repo",
        plan: detailedPlan,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.plan, detailedPlan);

    const staged = store.resolve(parsed.ref) as { plan?: string };
    assert.equal(staged.plan, detailedPlan);
  });

  it("stages resumeRemoteBranch when continue_existing_pr is set", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/pr-88",
        description: "Address review comments",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    const staged = store.resolve(parsed.ref) as { resumeRemoteBranch?: boolean };
    assert.equal(staged.resumeRemoteBranch, true);
  });

  it("accepts an off-convention branch name when continue_existing_pr is set", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "feature/human-made-branch",
        description: "Continue an existing PR",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, undefined);
    assert.equal(parsed.branch, "feature/human-made-branch");
    const staged = store.resolve(parsed.ref) as { resumeRemoteBranch?: boolean };
    assert.equal(staged.resumeRemoteBranch, true);
  });

  it("rejects a protected branch even with continue_existing_pr", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "main",
        description: "Continue on main",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("protected branch"));
    assert.equal(result.isError, true);
  });

  it("still rejects an off-convention branch name without continue_existing_pr", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "feature/human-made-branch",
        description: "Fresh change on a bad name",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: false,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("Invalid branch name"));
    assert.equal(result.isError, true);
  });

  it("omits resumeRemoteBranch when continue_existing_pr is not set", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/feat/new",
        description: "Fresh change",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    const staged = store.resolve(parsed.ref) as { resumeRemoteBranch?: boolean };
    assert.equal(staged.resumeRemoteBranch, undefined);
  });

  it("omits plan from the staged intent when not provided", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/feat/add-login",
        description: "Add login feature",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.plan, undefined);

    const staged = store.resolve(parsed.ref) as { plan?: string };
    assert.ok(!("plan" in staged));
  });

  it("includes existing worktree info when a worker holds the branch", async () => {
    deps = makeDeps({
      findWorkerByBranch: vi.fn(() => makeWorkerOnBranch()),
      readSessionState: vi.fn(async () =>
        makePersistedState({
          status: "executing",
          lastActivityAt: "2025-01-01T12:00:00Z",
        }),
      ),
    });

    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/existing",
        description: "Fix something",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.existingWorktree);
    assert.equal(parsed.existingWorktree.status, "executing");
    assert.equal(parsed.existingWorktree.lastActivity, "2025-01-01T12:00:00Z");
  });

  it("falls back to the worker's lastUsedAt when session state is null", async () => {
    const lastUsedAt = new Date("2025-06-15T09:00:00Z");
    deps = makeDeps({
      findWorkerByBranch: vi.fn(() => makeWorkerOnBranch({ lastUsedAt })),
      readSessionState: vi.fn(async () => null),
    });

    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/old",
        description: "Old fix",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.existingWorktree);
    assert.equal(parsed.existingWorktree.status, "unknown");
    assert.equal(parsed.existingWorktree.lastActivity, lastUsedAt.toISOString());
  });

  it("reports 'fresh' when a worker holds the branch but no session exists", async () => {
    deps = makeDeps({ findWorkerByBranch: vi.fn(() => makeWorkerOnBranch()) });

    const toolDef = createProposeChangeTool(makeCtx(), makeIntentStore(), deps);
    const result = await toolDef.handler(
      {
        branch: "clack/fix/existing",
        description: "Fix",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.existingWorktree.continuation, "fresh");
  });

  it("reports 'resume-here' when the session belongs to this conversation", async () => {
    deps = makeDeps({
      findActiveChangeByBranch: vi.fn(() => ({
        sessionId: "sess-1",
        change: makeChangeOnBranch(),
      })),
    });

    const toolDef = createProposeChangeTool(makeCtx(), makeIntentStore(), deps);
    const result = await toolDef.handler(
      {
        branch: "clack/fix/existing",
        description: "Fix",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.existingWorktree.continuation, "resume-here");
  });

  it("reports 'adopt' with the owner when another conversation's session is idle", async () => {
    deps = makeDeps({
      findActiveChangeByBranch: vi.fn(() => ({
        sessionId: "sess-old",
        change: makeChangeOnBranch(),
      })),
      classifyChangeSession: vi.fn((): ChangeSessionLiveness => "adoptable"),
      getActiveChangeRef: vi.fn(() => ({
        userId: "U999",
        channelId: "C-OLD",
        threadTs: "1.0",
        triggerType: "mentions",
      })),
    });

    const toolDef = createProposeChangeTool(makeCtx(), makeIntentStore(), deps);
    const result = await toolDef.handler(
      {
        branch: "clack/fix/existing",
        description: "Fix",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.existingWorktree.continuation, "adopt");
    assert.equal(parsed.existingWorktree.owner, "U999");
    assert.ok(parsed.existingWorktree.guidance.includes("MOVE"));
  });

  it("reports 'live' when another conversation's session is executing", async () => {
    deps = makeDeps({
      findActiveChangeByBranch: vi.fn(() => ({
        sessionId: "sess-old",
        change: makeChangeOnBranch({ status: "executing" }),
      })),
      classifyChangeSession: vi.fn((): ChangeSessionLiveness => "live"),
    });

    const toolDef = createProposeChangeTool(makeCtx(), makeIntentStore(), deps);
    const result = await toolDef.handler(
      {
        branch: "clack/fix/existing",
        description: "Fix",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: true,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.existingWorktree.continuation, "live");
    assert.ok(parsed.existingWorktree.guidance.includes("ACTIVELY EXECUTING"));
  });

  it("records the tool call on success", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createProposeChangeTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "clack/docs/readme",
        description: "Update readme",
        repo: "my-repo",
        plan: undefined,
        continue_existing_pr: undefined,
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.repo, "my-repo");
    assert.ok(parsed.ref, "should return a staged ref");
  });

  it("accepts all valid branch type prefixes", async () => {
    const types = ["fix", "feat", "refactor", "docs", "chore"];
    const ctx = makeCtx();

    for (const type of types) {
      const store = makeIntentStore();
      const toolDef = createProposeChangeTool(ctx, store, deps);

      const result = await toolDef.handler(
        {
          branch: `clack/${type}/test-branch`,
          description: `A ${type} change`,
          repo: "my-repo",
          plan: undefined,
          continue_existing_pr: undefined,
        },
        { sessionId: "test" },
      );

      const parsed = parseToolResult(result);
      assert.ok(parsed.ref, `Expected ref for branch type "${type}"`);
      assert.equal(parsed.branch, `clack/${type}/test-branch`);
    }
  });
});
