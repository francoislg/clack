import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetVisibleRepos = mock.fn<(...args: unknown[]) => unknown[]>();
const mockCanWriteRepo = mock.fn<(...args: unknown[]) => boolean>();

mock.module("../../repoAccess.js", {
  namedExports: {
    getVisibleRepos: mockGetVisibleRepos,
    canWriteRepo: mockCanWriteRepo,
  },
});

// Import after mocks
const { createListRepositoriesTool } = await import("./listRepositories.js");

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

function resetMocks() {
  mockGetVisibleRepos.mock.resetCalls();
  mockCanWriteRepo.mock.resetCalls();

  mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo()]);
  mockCanWriteRepo.mock.mockImplementation(() => true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listRepositories tool", () => {
  beforeEach(resetMocks);

  it("returns visible repos with name, description, and canChange", async () => {
    const ctx = makeCtx();
    const toolDef = createListRepositoriesTool(ctx);

    const result = await toolDef.handler({ includeChangeSupport: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, "my-repo");
    assert.equal(parsed[0].description, "Test repo");
    assert.equal(parsed[0].canChange, true);
  });

  it("returns canChange=false when user lacks write access", async () => {
    mockCanWriteRepo.mock.mockImplementation(() => false);

    const ctx = makeCtx();
    const toolDef = createListRepositoriesTool(ctx);

    const result = await toolDef.handler({ includeChangeSupport: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed[0].canChange, false);
  });

  it("includes canChange by default", async () => {
    const ctx = makeCtx();
    const toolDef = createListRepositoriesTool(ctx);

    const result = await toolDef.handler({ includeChangeSupport: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok("canChange" in parsed[0]);
  });

  it("includes canChange when includeChangeSupport=true", async () => {
    const ctx = makeCtx();
    const toolDef = createListRepositoriesTool(ctx);

    const result = await toolDef.handler({ includeChangeSupport: true }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok("canChange" in parsed[0]);
  });

  it("excludes canChange when includeChangeSupport=false", async () => {
    const ctx = makeCtx();
    const toolDef = createListRepositoriesTool(ctx);

    const result = await toolDef.handler({ includeChangeSupport: false }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed[0].canChange, undefined);
    assert.ok(!("canChange" in parsed[0]));
  });

  it("returns empty array when no repos are visible", async () => {
    mockGetVisibleRepos.mock.mockImplementation(() => []);

    const ctx = makeCtx();
    const toolDef = createListRepositoriesTool(ctx);

    const result = await toolDef.handler({ includeChangeSupport: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns multiple repos", async () => {
    const repos = [
      makeRepo({ name: "repo-a", description: "First repo" }),
      makeRepo({ name: "repo-b", description: "Second repo" }),
      makeRepo({ name: "repo-c", description: "Third repo" }),
    ];
    mockGetVisibleRepos.mock.mockImplementation(() => repos);

    const ctx = makeCtx();
    const toolDef = createListRepositoriesTool(ctx);

    const result = await toolDef.handler({ includeChangeSupport: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].name, "repo-a");
    assert.equal(parsed[1].name, "repo-b");
    assert.equal(parsed[2].name, "repo-c");
  });

  it("calls getVisibleRepos with role and config repos", async () => {
    const ctx = makeCtx({ role: "admin" });
    const toolDef = createListRepositoriesTool(ctx);

    await toolDef.handler({ includeChangeSupport: undefined }, { sessionId: "test" });

    assert.equal(mockGetVisibleRepos.mock.callCount(), 1);
    assert.equal(mockGetVisibleRepos.mock.calls[0].arguments[0], "admin");
  });
});
