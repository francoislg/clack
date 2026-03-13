import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetActiveWorkers = mock.fn<() => unknown[]>();

mock.module("../../changes/activeState.js", {
  namedExports: {
    getActiveWorkers: mockGetActiveWorkers,
  },
});

const mockGetVisibleRepos = mock.fn<(...args: unknown[]) => unknown[]>();

mock.module("../../repoAccess.js", {
  namedExports: {
    getVisibleRepos: mockGetVisibleRepos,
  },
});

// Import after mocks
const { createFindChangesTool } = await import("./findChanges.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";
import type { RepositoryConfig } from "../../config.js";

function makeRepo(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
  return {
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    description: "Test repo",
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
    ...overrides,
  };
}

function makeWorker(overrides?: Record<string, unknown>) {
  return {
    id: "w1",
    userId: "U123",
    status: "executing",
    description: "Fix login bug",
    branch: "clack/fix/login-bug",
    repo: "my-repo",
    prUrl: undefined,
    channel: "C1",
    threadTs: "1.0",
    startedAt: new Date("2025-06-01T10:00:00Z"),
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockGetActiveWorkers.mock.resetCalls();
  mockGetVisibleRepos.mock.resetCalls();

  mockGetActiveWorkers.mock.mockImplementation(() => []);
  mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo()]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findChanges tool", () => {
  beforeEach(resetMocks);

  it("returns empty array when no active workers", async () => {
    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx);

    const result = await toolDef.handler({ repo: undefined, status: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns active workers visible to the user", async () => {
    const worker = makeWorker();
    mockGetActiveWorkers.mock.mockImplementation(() => [worker]);

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx);

    const result = await toolDef.handler({ repo: undefined, status: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, "w1");
    assert.equal(parsed[0].branch, "clack/fix/login-bug");
    assert.equal(parsed[0].repo, "my-repo");
    assert.equal(parsed[0].description, "Fix login bug");
    assert.equal(parsed[0].status, "executing");
    assert.equal(parsed[0].startedAt, "2025-06-01T10:00:00.000Z");
  });

  it("filters out workers for repos not visible to the user", async () => {
    const worker1 = makeWorker({ repo: "my-repo" });
    const worker2 = makeWorker({ id: "w2", repo: "secret-repo" });
    mockGetActiveWorkers.mock.mockImplementation(() => [worker1, worker2]);
    // Only "my-repo" is visible
    mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo()]);

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx);

    const result = await toolDef.handler({ repo: undefined, status: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "my-repo");
  });

  it("filters by repo name when provided", async () => {
    const worker1 = makeWorker({ id: "w1", repo: "repo-a" });
    const worker2 = makeWorker({ id: "w2", repo: "repo-b" });
    mockGetActiveWorkers.mock.mockImplementation(() => [worker1, worker2]);
    mockGetVisibleRepos.mock.mockImplementation(() => [
      makeRepo({ name: "repo-a" }),
      makeRepo({ name: "repo-b" }),
    ]);

    const ctx = makeCtx({
      config: {
        repositories: [makeRepo({ name: "repo-a" }), makeRepo({ name: "repo-b" })],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindChangesTool(ctx);

    const result = await toolDef.handler({ repo: "repo-a", status: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "repo-a");
  });

  it("filters by status when provided", async () => {
    const worker1 = makeWorker({ id: "w1", status: "executing" });
    const worker2 = makeWorker({ id: "w2", status: "pr_created" });
    const worker3 = makeWorker({ id: "w3", status: "executing" });
    mockGetActiveWorkers.mock.mockImplementation(() => [worker1, worker2, worker3]);

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx);

    const result = await toolDef.handler({ repo: undefined, status: "executing" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 2);
    assert.ok(parsed.every((w: { status: string }) => w.status === "executing"));
  });

  it("filters by both repo and status simultaneously", async () => {
    const worker1 = makeWorker({ id: "w1", repo: "repo-a", status: "executing" });
    const worker2 = makeWorker({ id: "w2", repo: "repo-a", status: "pr_created" });
    const worker3 = makeWorker({ id: "w3", repo: "repo-b", status: "executing" });
    mockGetActiveWorkers.mock.mockImplementation(() => [worker1, worker2, worker3]);
    mockGetVisibleRepos.mock.mockImplementation(() => [
      makeRepo({ name: "repo-a" }),
      makeRepo({ name: "repo-b" }),
    ]);

    const ctx = makeCtx({
      config: {
        repositories: [makeRepo({ name: "repo-a" }), makeRepo({ name: "repo-b" })],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindChangesTool(ctx);

    const result = await toolDef.handler({ repo: "repo-a", status: "executing" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, "w1");
  });

  it("returns empty when no workers match repo filter", async () => {
    const worker = makeWorker({ repo: "my-repo" });
    mockGetActiveWorkers.mock.mockImplementation(() => [worker]);

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx);

    const result = await toolDef.handler({ repo: "nonexistent", status: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("includes prUrl when present on worker", async () => {
    const worker = makeWorker({ prUrl: "https://github.com/org/my-repo/pull/42" });
    mockGetActiveWorkers.mock.mockImplementation(() => [worker]);

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx);

    const result = await toolDef.handler({ repo: undefined, status: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed[0].prUrl, "https://github.com/org/my-repo/pull/42");
  });

  it("serializes startedAt as ISO string", async () => {
    const worker = makeWorker({ startedAt: new Date("2025-12-25T00:00:00Z") });
    mockGetActiveWorkers.mock.mockImplementation(() => [worker]);

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx);

    const result = await toolDef.handler({ repo: undefined, status: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed[0].startedAt, "2025-12-25T00:00:00.000Z");
  });
});
