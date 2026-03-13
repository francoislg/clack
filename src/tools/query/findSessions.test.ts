import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetResumableSessions = mock.fn<() => Promise<unknown[]>>();

mock.module("../../changes/persistence.js", {
  namedExports: {
    getResumableSessions: mockGetResumableSessions,
  },
});

const mockGetVisibleRepos = mock.fn<(...args: unknown[]) => unknown[]>();

mock.module("../../repoAccess.js", {
  namedExports: {
    getVisibleRepos: mockGetVisibleRepos,
  },
});

// Import after mocks
const { createFindSessionsTool } = await import("./findSessions.js");

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
    changesWorkflowEnabled: false,
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function makeSession(overrides?: Record<string, unknown>) {
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

function resetMocks() {
  mockGetResumableSessions.mock.resetCalls();
  mockGetVisibleRepos.mock.resetCalls();

  mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo()]);
  mockGetResumableSessions.mock.mockImplementation(async () => []);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findSessions tool", () => {
  beforeEach(resetMocks);

  it("returns empty array when no sessions exist", async () => {
    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx);

    const result = await toolDef.handler({ repo: undefined, branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns sessions for visible repos", async () => {
    const session = makeSession();
    mockGetResumableSessions.mock.mockImplementation(async () => [session]);

    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx);

    const result = await toolDef.handler({ repo: undefined, branch: undefined }, { sessionId: "test" });

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
    mockGetResumableSessions.mock.mockImplementation(async () => [visibleSession, hiddenSession]);

    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx);

    const result = await toolDef.handler({ repo: undefined, branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "my-repo");
  });

  it("filters by repo name", async () => {
    const session1 = makeSession({ repo: "my-repo" });
    const session2 = makeSession({ repo: "other-repo", branchName: "clack/feat/other" });
    mockGetResumableSessions.mock.mockImplementation(async () => [session1, session2]);
    mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo(), makeRepo({ name: "other-repo" })]);

    const ctx = makeCtx({
      config: {
        repositories: [makeRepo(), makeRepo({ name: "other-repo" })],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindSessionsTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "my-repo");
  });

  it("filters by branch name with partial match", async () => {
    const session1 = makeSession({ branchName: "clack/fix/login-bug" });
    const session2 = makeSession({ branchName: "clack/feat/signup-flow" });
    mockGetResumableSessions.mock.mockImplementation(async () => [session1, session2]);

    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx);

    const result = await toolDef.handler({ repo: undefined, branch: "login" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].branchName, "clack/fix/login-bug");
  });

  it("applies both repo and branch filters together", async () => {
    const session1 = makeSession({ repo: "my-repo", branchName: "clack/fix/login" });
    const session2 = makeSession({ repo: "my-repo", branchName: "clack/feat/signup" });
    const session3 = makeSession({ repo: "other-repo", branchName: "clack/fix/login-other" });
    mockGetResumableSessions.mock.mockImplementation(async () => [session1, session2, session3]);
    mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo(), makeRepo({ name: "other-repo" })]);

    const ctx = makeCtx({
      config: {
        repositories: [makeRepo(), makeRepo({ name: "other-repo" })],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindSessionsTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", branch: "login" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].repo, "my-repo");
    assert.equal(parsed[0].branchName, "clack/fix/login");
  });

  it("does not leak extra session fields beyond the mapped properties", async () => {
    const session = makeSession({ secretField: "should-not-appear" });
    mockGetResumableSessions.mock.mockImplementation(async () => [session]);

    const ctx = makeCtx();
    const toolDef = createFindSessionsTool(ctx);

    const result = await toolDef.handler({ repo: undefined, branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].secretField, undefined);
    const keys = Object.keys(parsed[0]);
    assert.deepEqual(keys.sort(), ["branchName", "description", "lastMessage", "phase", "repo", "startedAt"]);
  });
});
