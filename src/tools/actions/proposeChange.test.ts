import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createProposeChangeTool, type ProposeChangeDeps } from "./proposeChange.js";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import type { RepositoryConfig } from "../../config.js";
import type { PersistedSessionState } from "../../changes/types.js";

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
    getExistingWorktree: mock.fn(() => null),
    readSessionState: mock.fn(async () => null),
    canWriteRepo: mock.fn(() => true),
    getWritableRepos: mock.fn(() => [makeRepo()]),
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
      originalQuestion: "test",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: {
      repositories: [makeRepo()],
    } as QueryToolContext["config"],
    changesWorkflowEnabled: true,
    allowScheduledMessages: false,
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

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("my-repo")); // lists available repos
    assert.equal(result.isError, true);
  });

  it("rejects when user lacks write access", async () => {
    deps = makeDeps({
      canWriteRepo: mock.fn(() => false),
      getWritableRepos: mock.fn(() => []),
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("write access"));
    assert.equal(result.isError, true);
  });

  it("shows writable repos when user lacks write access but has other repos", async () => {
    const otherRepo = makeRepo({ name: "other-repo" });
    deps = makeDeps({
      canWriteRepo: mock.fn(() => false),
      getWritableRepos: mock.fn(() => [otherRepo]),
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.plan, detailedPlan);

    const staged = store.resolve(parsed.ref) as { plan?: string };
    assert.equal(staged.plan, detailedPlan);
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.plan, undefined);

    const staged = store.resolve(parsed.ref) as { plan?: string };
    assert.ok(!("plan" in staged));
  });

  it("includes existing worktree info when worktree exists", async () => {
    deps = makeDeps({
      getExistingWorktree: mock.fn(() => ({
        repoName: "my-repo",
        branchName: "clack/fix/existing",
        worktreePath: "/tmp/worktrees/my-repo/clack-fix-existing",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      })),
      readSessionState: mock.fn(
        async () =>
          ({
            status: "in_progress",
            lastActivityAt: "2025-01-01T12:00:00Z",
          }) as never as PersistedSessionState,
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.existingWorktree);
    assert.equal(parsed.existingWorktree.status, "in_progress");
    assert.equal(parsed.existingWorktree.lastActivity, "2025-01-01T12:00:00Z");
  });

  it("falls back to worktree createdAt when session state is null", async () => {
    const createdAt = new Date("2025-06-15T09:00:00Z");
    deps = makeDeps({
      getExistingWorktree: mock.fn(() => ({
        repoName: "my-repo",
        branchName: "clack/fix/old",
        worktreePath: "/tmp/worktrees/my-repo/clack-fix-old",
        createdAt,
      })),
      readSessionState: mock.fn(async () => null),
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.existingWorktree);
    assert.equal(parsed.existingWorktree.status, "unknown");
    assert.equal(parsed.existingWorktree.lastActivity, createdAt.toISOString());
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
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
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
        },
        { sessionId: "test" },
      );

      const parsed = parseResult(result);
      assert.ok(parsed.ref, `Expected ref for branch type "${type}"`);
      assert.equal(parsed.branch, `clack/${type}/test-branch`);
    }
  });
});
