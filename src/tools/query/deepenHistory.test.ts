import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createDeepenHistoryTool, type DeepenHistoryDeps } from "./deepenHistory.js";
import type { QueryToolContext } from "../types.js";
import type { RepositoryConfig } from "../../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const mockGitRaw = mock.fn<(...args: unknown[]) => Promise<string>>();

function makeSimpleGit(): DeepenHistoryDeps["simpleGit"] {
  return (_opts: { baseDir: string }) => ({ raw: (...args: string[][]) => mockGitRaw(...args) });
}

function makeDeps(overrides: Partial<DeepenHistoryDeps> = {}): DeepenHistoryDeps {
  return {
    getVisibleRepos: mock.fn((_role: string, _repos: RepositoryConfig[]) => [
      makeRepo(),
    ]) as DeepenHistoryDeps["getVisibleRepos"],
    getRepositoriesDir: mock.fn(
      () => "/data/repositories",
    ) as DeepenHistoryDeps["getRepositoriesDir"],
    existsSync: mock.fn((_path: string) => true) as DeepenHistoryDeps["existsSync"],
    simpleGit: makeSimpleGit(),
    setAuthenticatedRemote: mock.fn(async () => {}) as DeepenHistoryDeps["setAuthenticatedRemote"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deepenHistory tool", () => {
  beforeEach(() => {
    mockGitRaw.mock.resetCalls();
  });

  it("returns error for unknown repository", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "nonexistent-repo", commits: undefined, full: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("my-repo"));
    assert.equal(result.isError, true);
  });

  it("returns error when repo has not been cloned", async () => {
    const deps = makeDeps({
      existsSync: mock.fn((_path: string) => false) as DeepenHistoryDeps["existsSync"],
    });
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", commits: undefined, full: undefined },
      { sessionId: "test" },
    );

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

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", commits: undefined, full: undefined },
      { sessionId: "test" },
    );

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
        const isShallowCallCount = rawCalls.filter((c) =>
          c.includes("--is-shallow-repository"),
        ).length;
        return isShallowCallCount <= 1 ? "true\n" : "false\n";
      }
      if (cmdArgs.includes("--count")) return "200\n";
      return "";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", commits: undefined, full: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.message.includes("100"));
    assert.equal(parsed.availableCommits, 200);

    // Verify --deepen=100 was called
    const deepenCall = rawCalls.find((c) => c.some((a) => a.startsWith("--deepen=")));
    assert.ok(deepenCall);
    assert.ok(deepenCall!.includes("--deepen=100"));
  });

  it("deepens with custom commit count", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) {
        const count = rawCalls.filter((c) => c.includes("--is-shallow-repository")).length;
        return count <= 1 ? "true\n" : "true\n";
      }
      if (cmdArgs.includes("--count")) return "350\n";
      return "";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", commits: 250, full: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.message.includes("250"));

    const deepenCall = rawCalls.find((c) => c.some((a) => a.startsWith("--deepen=")));
    assert.ok(deepenCall);
    assert.ok(deepenCall!.includes("--deepen=250"));
  });

  it("unshallows completely when full=true", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) {
        const count = rawCalls.filter((c) => c.includes("--is-shallow-repository")).length;
        return count <= 1 ? "true\n" : "false\n";
      }
      if (cmdArgs.includes("--count")) return "1000\n";
      return "";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", commits: undefined, full: true },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.message.includes("unshallowed"));
    assert.equal(parsed.shallow, false);
    assert.equal(parsed.availableCommits, 1000);

    const unshallowCall = rawCalls.find((c) => c.includes("--unshallow"));
    assert.ok(unshallowCall);
  });

  it("refreshes authenticated remote before fetching", async () => {
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "true\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "";
    });

    const mockSetAuth = mock.fn(async () => {});
    const deps = makeDeps({
      setAuthenticatedRemote: mockSetAuth as DeepenHistoryDeps["setAuthenticatedRemote"],
    });
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    await toolDef.handler(
      { repo: "my-repo", commits: undefined, full: undefined },
      { sessionId: "test" },
    );

    assert.equal(mockSetAuth.mock.callCount(), 1);
  });

  it("returns error when git operation fails", async () => {
    mockGitRaw.mock.mockImplementation(async () => {
      throw new Error("git fetch failed: network error");
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", commits: undefined, full: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to deepen history"));
    assert.ok(parsed.error.includes("network error"));
    assert.equal(result.isError, true);
  });

  it("only shows repos visible to the user's role", async () => {
    const adminRepo = makeRepo({ name: "admin-only", access: { read: "admin" } });
    const deps = makeDeps({
      getVisibleRepos: mock.fn(() => [adminRepo]) as DeepenHistoryDeps["getVisibleRepos"],
    });

    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    // Try to access a repo not in the visible list
    const result = await toolDef.handler(
      { repo: "my-repo", commits: undefined, full: undefined },
      { sessionId: "test" },
    );

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

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createDeepenHistoryTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", commits: undefined, full: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.availableCommits, 0);
  });
});
