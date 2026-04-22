import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createFindSessionsTool, type FindSessionsDeps } from "./findSessions.js";
import type { QueryToolContext } from "../types.js";
import type { RepositoryConfig } from "../../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SessionOverrides {
  branchName?: string;
  repo?: string;
  description?: string;
  phase?: string;
  lastMessage?: string;
  startedAt?: string;
  secretField?: string;
}

function makeRepo(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
  return {
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    description: "Test repo",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<FindSessionsDeps> = {}): FindSessionsDeps {
  return {
    getResumableSessions: mock.fn(async () => []) as FindSessionsDeps["getResumableSessions"],
    getVisibleRepos: mock.fn((_role, _repos) => [
      makeRepo(),
    ]) as FindSessionsDeps["getVisibleRepos"],
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
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function makeSession(overrides?: SessionOverrides) {
  return {
    branchName: "clack/fix/some-bug",
    repo: "my-repo",
    description: "Fix a bug",
    phase: "in_progress",
    lastMessage: "Working on it",
    startedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findSessions tool", () => {
  it("returns empty array when no sessions exist", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, branch: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns sessions for visible repos", async () => {
    const session = makeSession();
    const deps = makeDeps({
      getResumableSessions: mock.fn(async () => [
        session,
      ]) as FindSessionsDeps["getResumableSessions"],
    });
    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, branch: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].branchName, "clack/fix/some-bug");
    assert.equal(parsed[0].repo, "my-repo");
    assert.equal(parsed[0].description, "Fix a bug");
    assert.equal(parsed[0].phase, "in_progress");
    assert.equal(parsed[0].lastMessage, "Working on it");
    assert.equal(parsed[0].startedAt, "2025-01-01T00:00:00Z");
  });

  it("filters out sessions for repos not visible to user", async () => {
    const visibleSession = makeSession({ repo: "my-repo" });
    const hiddenSession = makeSession({ repo: "secret-repo", branchName: "clack/feat/hidden" });
    const deps = makeDeps({
      getResumableSessions: mock.fn(async () => [
        visibleSession,
        hiddenSession,
      ]) as FindSessionsDeps["getResumableSessions"],
    });
    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, branch: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "my-repo");
  });

  it("filters by repo name", async () => {
    const session1 = makeSession({ repo: "my-repo" });
    const session2 = makeSession({ repo: "other-repo", branchName: "clack/feat/other" });
    const deps = makeDeps({
      getResumableSessions: mock.fn(async () => [
        session1,
        session2,
      ]) as FindSessionsDeps["getResumableSessions"],
      getVisibleRepos: mock.fn((_role, _repos) => [
        makeRepo(),
        makeRepo({ name: "other-repo" }),
      ]) as FindSessionsDeps["getVisibleRepos"],
    });

    const ctx = makeCtx({
      config: {
        repositories: [makeRepo(), makeRepo({ name: "other-repo" })],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindSessionsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", branch: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "my-repo");
  });

  it("filters by branch name with partial match", async () => {
    const session1 = makeSession({ branchName: "clack/fix/login-bug" });
    const session2 = makeSession({ branchName: "clack/feat/signup-flow" });
    const deps = makeDeps({
      getResumableSessions: mock.fn(async () => [
        session1,
        session2,
      ]) as FindSessionsDeps["getResumableSessions"],
    });
    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, branch: "login" },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].branchName, "clack/fix/login-bug");
  });

  it("applies both repo and branch filters together", async () => {
    const session1 = makeSession({ repo: "my-repo", branchName: "clack/fix/login" });
    const session2 = makeSession({ repo: "my-repo", branchName: "clack/feat/signup" });
    const session3 = makeSession({ repo: "other-repo", branchName: "clack/fix/login-other" });
    const deps = makeDeps({
      getResumableSessions: mock.fn(async () => [
        session1,
        session2,
        session3,
      ]) as FindSessionsDeps["getResumableSessions"],
      getVisibleRepos: mock.fn((_role, _repos) => [
        makeRepo(),
        makeRepo({ name: "other-repo" }),
      ]) as FindSessionsDeps["getVisibleRepos"],
    });

    const ctx = makeCtx({
      config: {
        repositories: [makeRepo(), makeRepo({ name: "other-repo" })],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindSessionsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", branch: "login" },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "my-repo");
    assert.equal(parsed[0].branchName, "clack/fix/login");
  });

  it("does not leak extra session fields beyond the mapped properties", async () => {
    const session = makeSession({ secretField: "should-not-appear" });
    const deps = makeDeps({
      getResumableSessions: mock.fn(async () => [
        session,
      ]) as FindSessionsDeps["getResumableSessions"],
    });
    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: undefined, branch: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].secretField, undefined);
    const keys = Object.keys(parsed[0]);
    assert.deepEqual(keys.sort(), [
      "branchName",
      "description",
      "lastMessage",
      "phase",
      "repo",
      "startedAt",
    ]);
  });
});
