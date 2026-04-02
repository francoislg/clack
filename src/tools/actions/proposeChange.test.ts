import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetExistingWorktree = mock.fn<(...args: unknown[]) => unknown>();
const mockReadSessionState = mock.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCanWriteRepo = mock.fn<(...args: unknown[]) => boolean>();
const mockGetWritableRepos = mock.fn<(...args: unknown[]) => unknown[]>();

mock.module("../../worktrees.js", {
  namedExports: {
    getExistingWorktree: mockGetExistingWorktree,
  },
});

mock.module("../../changes/persistence.js", {
  namedExports: {
    readSessionState: mockReadSessionState,
  },
});

mock.module("../../repoAccess.js", {
  namedExports: {
    canWriteRepo: mockCanWriteRepo,
    getWritableRepos: mockGetWritableRepos,
  },
});

mock.module("../../logger.js", {
  namedExports: {
    logger: {
      debug: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
    },
  },
});

// Import after mocks
const { createProposeChangeTool } = await import("./proposeChange.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";
import type { RepositoryConfig } from "../../config.js";

function makeRepo(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
  return {
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    description: "Test repo",
    access: { read: "member", write: "dev" },
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
  const intents = new Map<string, unknown>();
  let counter = 0;
  return {
    stage: (intent: unknown) => {
      const ref = `ref-${++counter}`;
      intents.set(ref, intent);
      return ref;
    },
    resolve: (ref: string) => intents.get(ref) as ReturnType<IntentStore["resolve"]>,
    getAll: () => intents as ReturnType<IntentStore["getAll"]>,
  };
}

function makeRecorder(): ToolCallRecorder & {
  calls: Array<{ tool: string; args: unknown; result: unknown }>;
} {
  const calls: Array<{ tool: string; args: unknown; result: unknown }> = [];
  return {
    calls,
    record: (tool: string, args: Record<string, unknown>, result: Record<string, unknown>) => {
      calls.push({ tool, args, result });
    },
    getHistory: () => [],
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockGetExistingWorktree.mock.resetCalls();
  mockReadSessionState.mock.resetCalls();
  mockCanWriteRepo.mock.resetCalls();
  mockGetWritableRepos.mock.resetCalls();

  mockGetExistingWorktree.mock.mockImplementation(() => null);
  mockReadSessionState.mock.mockImplementation(async () => null);
  mockCanWriteRepo.mock.mockImplementation(() => true);
  mockGetWritableRepos.mock.mockImplementation(() => [makeRepo()]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proposeChange tool", () => {
  beforeEach(resetMocks);

  it("rejects invalid branch name format", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeChangeTool(ctx, store, recorder);

    const result = await toolDef.handler(
      {
        branch: "bad-branch-name",
        description: "fix a bug",
        repo: "my-repo",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid branch name"));
    assert.equal(result.isError, true);
    assert.equal(recorder.calls.length, 1);
  });

  it("rejects branch with wrong type prefix", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeChangeTool(ctx, store, recorder);

    const result = await toolDef.handler(
      {
        branch: "clack/bugfix/my-change",
        description: "fix a bug",
        repo: "my-repo",
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
    const recorder = makeRecorder();
    const toolDef = createProposeChangeTool(ctx, store, recorder);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/my-change",
        description: "fix something",
        repo: "nonexistent-repo",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("my-repo")); // lists available repos
    assert.equal(result.isError, true);
  });

  it("rejects when user lacks write access", async () => {
    mockCanWriteRepo.mock.mockImplementation(() => false);
    mockGetWritableRepos.mock.mockImplementation(() => []);

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeChangeTool(ctx, store, recorder);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/my-change",
        description: "fix something",
        repo: "my-repo",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("write access"));
    assert.equal(result.isError, true);
  });

  it("shows writable repos when user lacks write access but has other repos", async () => {
    mockCanWriteRepo.mock.mockImplementation(() => false);
    const otherRepo = makeRepo({ name: "other-repo" });
    mockGetWritableRepos.mock.mockImplementation(() => [otherRepo]);

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeChangeTool(ctx, store, recorder);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/my-change",
        description: "fix something",
        repo: "my-repo",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("other-repo"));
  });

  it("stages intent and returns ref on valid input", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeChangeTool(ctx, store, recorder);

    const result = await toolDef.handler(
      {
        branch: "clack/feat/add-login",
        description: "Add login feature",
        repo: "my-repo",
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

  it("includes existing worktree info when worktree exists", async () => {
    mockGetExistingWorktree.mock.mockImplementation(() => ({
      repoName: "my-repo",
      branchName: "clack/fix/existing",
      worktreePath: "/tmp/worktrees/my-repo/clack-fix-existing",
      createdAt: new Date("2025-01-01T00:00:00Z"),
    }));
    mockReadSessionState.mock.mockImplementation(async () => ({
      status: "in_progress",
      lastActivityAt: "2025-01-01T12:00:00Z",
    }));

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeChangeTool(ctx, store, recorder);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/existing",
        description: "Fix something",
        repo: "my-repo",
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
    mockGetExistingWorktree.mock.mockImplementation(() => ({
      repoName: "my-repo",
      branchName: "clack/fix/old",
      worktreePath: "/tmp/worktrees/my-repo/clack-fix-old",
      createdAt,
    }));
    mockReadSessionState.mock.mockImplementation(async () => null);

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeChangeTool(ctx, store, recorder);

    const result = await toolDef.handler(
      {
        branch: "clack/fix/old",
        description: "Old fix",
        repo: "my-repo",
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
    const recorder = makeRecorder();
    const toolDef = createProposeChangeTool(ctx, store, recorder);

    await toolDef.handler(
      {
        branch: "clack/docs/readme",
        description: "Update readme",
        repo: "my-repo",
      },
      { sessionId: "test" },
    );

    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].tool, "propose_change");
    assert.equal((recorder.calls[0].result as { repo: string }).repo, "my-repo");
  });

  it("accepts all valid branch type prefixes", async () => {
    const types = ["fix", "feat", "refactor", "docs", "chore"];
    const ctx = makeCtx();

    for (const type of types) {
      const store = makeIntentStore();
      const recorder = makeRecorder();
      const toolDef = createProposeChangeTool(ctx, store, recorder);

      const result = await toolDef.handler(
        {
          branch: `clack/${type}/test-branch`,
          description: `A ${type} change`,
          repo: "my-repo",
        },
        { sessionId: "test" },
      );

      const parsed = parseResult(result);
      assert.ok(parsed.ref, `Expected ref for branch type "${type}"`);
      assert.equal(parsed.branch, `clack/${type}/test-branch`);
    }
  });
});
