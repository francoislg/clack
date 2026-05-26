import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createFindChangesTool, type FindChangesDeps } from "./findChanges.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";
import type { RepositoryConfig } from "../../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WorkerOverrides {
  id?: string;
  userId?: string;
  status?: string;
  description?: string;
  branch?: string;
  repo?: string;
  prUrl?: string;
  channel?: string;
  threadTs?: string;
  startedAt?: Date;
}

function makeRepo(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
  return {
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    description: "Test repo",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<FindChangesDeps> = {}): FindChangesDeps {
  return {
    getActiveWorkers: vi.fn(() => []) as FindChangesDeps["getActiveWorkers"],
    getVisibleRepos: vi.fn((_role, _repos) => [makeRepo()]) as FindChangesDeps["getVisibleRepos"],
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

function makeWorker(overrides?: WorkerOverrides) {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findChanges tool", () => {
  it("returns empty array when no active workers", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, status: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns active workers visible to the user", async () => {
    const worker = makeWorker();
    const deps = makeDeps({
      getActiveWorkers: vi.fn(() => [worker]) as FindChangesDeps["getActiveWorkers"],
    });
    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, status: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
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
    const deps = makeDeps({
      getActiveWorkers: vi.fn(() => [worker1, worker2]) as FindChangesDeps["getActiveWorkers"],
    });

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, status: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "my-repo");
  });

  it("filters by repo name when provided", async () => {
    const worker1 = makeWorker({ id: "w1", repo: "repo-a" });
    const worker2 = makeWorker({ id: "w2", repo: "repo-b" });
    const deps = makeDeps({
      getActiveWorkers: vi.fn(() => [worker1, worker2]) as FindChangesDeps["getActiveWorkers"],
      getVisibleRepos: vi.fn((_role, _repos) => [
        makeRepo({ name: "repo-a" }),
        makeRepo({ name: "repo-b" }),
      ]) as FindChangesDeps["getVisibleRepos"],
    });

    const ctx = makeCtx({
      config: {
        repositories: [makeRepo({ name: "repo-a" }), makeRepo({ name: "repo-b" })],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindChangesTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "repo-a", status: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "repo-a");
  });

  it("filters by status when provided", async () => {
    const worker1 = makeWorker({ id: "w1", status: "executing" });
    const worker2 = makeWorker({ id: "w2", status: "pr_created" });
    const worker3 = makeWorker({ id: "w3", status: "executing" });
    const deps = makeDeps({
      getActiveWorkers: vi.fn(() => [
        worker1,
        worker2,
        worker3,
      ]) as FindChangesDeps["getActiveWorkers"],
    });

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, status: "executing" },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.length, 2);
    assert.ok(parsed.every((w: { status: string }) => w.status === "executing"));
  });

  it("filters by both repo and status simultaneously", async () => {
    const worker1 = makeWorker({ id: "w1", repo: "repo-a", status: "executing" });
    const worker2 = makeWorker({ id: "w2", repo: "repo-a", status: "pr_created" });
    const worker3 = makeWorker({ id: "w3", repo: "repo-b", status: "executing" });
    const deps = makeDeps({
      getActiveWorkers: vi.fn(() => [
        worker1,
        worker2,
        worker3,
      ]) as FindChangesDeps["getActiveWorkers"],
      getVisibleRepos: vi.fn((_role, _repos) => [
        makeRepo({ name: "repo-a" }),
        makeRepo({ name: "repo-b" }),
      ]) as FindChangesDeps["getVisibleRepos"],
    });

    const ctx = makeCtx({
      config: {
        repositories: [makeRepo({ name: "repo-a" }), makeRepo({ name: "repo-b" })],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindChangesTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "repo-a", status: "executing" },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, "w1");
  });

  it("returns empty when no workers match repo filter", async () => {
    const worker = makeWorker({ repo: "my-repo" });
    const deps = makeDeps({
      getActiveWorkers: vi.fn(() => [worker]) as FindChangesDeps["getActiveWorkers"],
    });

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "nonexistent", status: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, []);
  });

  it("includes prUrl when present on worker", async () => {
    const worker = makeWorker({ prUrl: "https://github.com/org/my-repo/pull/42" });
    const deps = makeDeps({
      getActiveWorkers: vi.fn(() => [worker]) as FindChangesDeps["getActiveWorkers"],
    });

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, status: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed[0].prUrl, "https://github.com/org/my-repo/pull/42");
  });

  it("serializes startedAt as ISO string", async () => {
    const worker = makeWorker({ startedAt: new Date("2025-12-25T00:00:00Z") });
    const deps = makeDeps({
      getActiveWorkers: vi.fn(() => [worker]) as FindChangesDeps["getActiveWorkers"],
    });

    const ctx = makeCtx();
    const toolDef = createFindChangesTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, status: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed[0].startedAt, "2025-12-25T00:00:00.000Z");
  });
});
