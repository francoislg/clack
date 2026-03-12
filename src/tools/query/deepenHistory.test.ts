import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as realFs from "node:fs";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockExistsSync = mock.fn<(path: string) => boolean>();

mock.module("node:fs", {
  namedExports: {
    ...realFs,
    existsSync: mockExistsSync,
  },
});

const mockGetVisibleRepos = mock.fn<(...args: unknown[]) => unknown[]>();

mock.module("../../repoAccess.js", {
  namedExports: {
    getVisibleRepos: mockGetVisibleRepos,
  },
});

const mockGetRepositoriesDir = mock.fn<() => string>();

mock.module("../../config.js", {
  namedExports: {
    getRepositoriesDir: mockGetRepositoriesDir,
  },
});

const mockSetAuthenticatedRemote = mock.fn<(...args: unknown[]) => Promise<void>>();

mock.module("../../repositories.js", {
  namedExports: {
    setAuthenticatedRemote: mockSetAuthenticatedRemote,
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

// Mock simpleGit
const mockGitRaw = mock.fn<(...args: unknown[]) => Promise<string>>();

mock.module("simple-git", {
  namedExports: {
    simpleGit: () => ({
      raw: mockGitRaw,
    }),
  },
});

// Import after mocks
const { createDeepenHistoryTool } = await import("./deepenHistory.js");

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
  mockExistsSync.mock.resetCalls();
  mockGetVisibleRepos.mock.resetCalls();
  mockGetRepositoriesDir.mock.resetCalls();
  mockSetAuthenticatedRemote.mock.resetCalls();
  mockGitRaw.mock.resetCalls();

  mockGetRepositoriesDir.mock.mockImplementation(() => "/data/repositories");
  mockExistsSync.mock.mockImplementation(() => true);
  mockSetAuthenticatedRemote.mock.mockImplementation(async () => {});
  mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo()]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deepenHistory tool", () => {
  beforeEach(resetMocks);

  it("returns error for unknown repository", async () => {
    mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo()]);
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    const result = await toolDef.handler({ repo: "nonexistent-repo", commits: undefined, full: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("my-repo"));
    assert.equal(result.isError, true);
  });

  it("returns error when repo has not been cloned", async () => {
    mockExistsSync.mock.mockImplementation(() => false);
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", commits: undefined, full: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not been cloned"));
    assert.equal(result.isError, true);
  });

  it("returns info message when repo already has full history", async () => {
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "500\n";
      return "";
    });

    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", commits: undefined, full: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.message.includes("full history"));
    assert.equal(parsed.shallow, false);
    assert.equal(parsed.availableCommits, 500);
    assert.equal(result.isError, undefined);
  });

  it("deepens with default 100 commits when no options specified", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) {
        // First call: shallow; after fetch: not shallow
        const isShallowCallCount = rawCalls.filter(c => c.includes("--is-shallow-repository")).length;
        return isShallowCallCount <= 1 ? "true\n" : "false\n";
      }
      if (cmdArgs.includes("--count")) return "200\n";
      return "";
    });

    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", commits: undefined, full: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.message.includes("100"));
    assert.equal(parsed.availableCommits, 200);

    // Verify --deepen=100 was called
    const deepenCall = rawCalls.find(c => c.some(a => a.startsWith("--deepen=")));
    assert.ok(deepenCall);
    assert.ok(deepenCall!.includes("--deepen=100"));
  });

  it("deepens with custom commit count", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) {
        const count = rawCalls.filter(c => c.includes("--is-shallow-repository")).length;
        return count <= 1 ? "true\n" : "true\n";
      }
      if (cmdArgs.includes("--count")) return "350\n";
      return "";
    });

    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", commits: 250, full: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.message.includes("250"));

    const deepenCall = rawCalls.find(c => c.some(a => a.startsWith("--deepen=")));
    assert.ok(deepenCall);
    assert.ok(deepenCall!.includes("--deepen=250"));
  });

  it("unshallows completely when full=true", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) {
        const count = rawCalls.filter(c => c.includes("--is-shallow-repository")).length;
        return count <= 1 ? "true\n" : "false\n";
      }
      if (cmdArgs.includes("--count")) return "1000\n";
      return "";
    });

    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", commits: undefined, full: true }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.message.includes("unshallowed"));
    assert.equal(parsed.shallow, false);
    assert.equal(parsed.availableCommits, 1000);

    const unshallowCall = rawCalls.find(c => c.includes("--unshallow"));
    assert.ok(unshallowCall);
  });

  it("refreshes authenticated remote before fetching", async () => {
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "true\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "";
    });

    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    await toolDef.handler({ repo: "my-repo", commits: undefined, full: undefined }, { sessionId: "test" });

    assert.equal(mockSetAuthenticatedRemote.mock.callCount(), 1);
  });

  it("returns error when git operation fails", async () => {
    mockGitRaw.mock.mockImplementation(async () => {
      throw new Error("git fetch failed: network error");
    });

    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", commits: undefined, full: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to deepen history"));
    assert.ok(parsed.error.includes("network error"));
    assert.equal(result.isError, true);
  });

  it("only shows repos visible to the user's role", async () => {
    const adminRepo = makeRepo({ name: "admin-only", access: { read: "admin" } });
    mockGetVisibleRepos.mock.mockImplementation(() => [adminRepo]);

    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    // Try to access a repo not in the visible list
    const result = await toolDef.handler({ repo: "my-repo", commits: undefined, full: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("admin-only"));
  });

  it("handles zero commit count from rev-list", async () => {
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "not-a-number\n";
      return "";
    });

    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", commits: undefined, full: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.availableCommits, 0);
  });
});
