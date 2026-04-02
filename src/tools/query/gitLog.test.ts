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
const { createGitLogTool } = await import("./gitLog.js");

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
    allowScheduledMessages: false,
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
  mockGitRaw.mock.resetCalls();

  mockGetRepositoriesDir.mock.mockImplementation(() => "/data/repositories");
  mockExistsSync.mock.mockImplementation(() => true);
  mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo()]);
  mockGitRaw.mock.mockImplementation(async (args: unknown) => {
    const cmdArgs = args as string[];
    if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
    if (cmdArgs.includes("--count")) return "100\n";
    return "commit abc123\nAuthor: test\n";
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gitLog tool", () => {
  beforeEach(resetMocks);

  it("returns error for unknown repository", async () => {
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    const result = await toolDef.handler(
      { repo: "nonexistent", args: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("my-repo"));
    assert.equal(result.isError, true);
  });

  it("returns error when repo has not been cloned", async () => {
    mockExistsSync.mock.mockImplementation(() => false);

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    const result = await toolDef.handler(
      { repo: "my-repo", args: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not been cloned"));
    assert.equal(result.isError, true);
  });

  it("returns git log output with metadata", async () => {
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "true\n";
      if (cmdArgs.includes("--count")) return "50\n";
      if (cmdArgs[0] === "log") return "commit abc123\nsome log output\n";
      return "";
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    const result = await toolDef.handler(
      { repo: "my-repo", args: ["--oneline", "-n", "5"] },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.output.includes("commit abc123"));
    assert.equal(parsed.shallow, true);
    assert.equal(parsed.availableCommits, 50);
    assert.equal(parsed.truncated, false);
    assert.equal(result.isError, undefined);
  });

  it("passes user-provided args to git log", async () => {
    const rawCalls: unknown[][] = [];
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "log output";
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    await toolDef.handler(
      { repo: "my-repo", args: ["--oneline", "--author=John", "-n", "20"] },
      { sessionId: "test" },
    );

    const logCall = rawCalls.find((c) => (c as string[])[0] === "log") as string[];
    assert.ok(logCall);
    assert.ok(logCall.includes("--oneline"));
    assert.ok(logCall.includes("--author=John"));
    assert.ok(logCall.includes("-n"));
    assert.ok(logCall.includes("20"));
  });

  it("uses empty args array when no args provided", async () => {
    const rawCalls: unknown[][] = [];
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "log output";
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    await toolDef.handler({ repo: "my-repo", args: undefined }, { sessionId: "test" });

    const logCall = rawCalls.find((c) => (c as string[])[0] === "log") as string[];
    assert.ok(logCall);
    assert.deepEqual(logCall, ["log"]);
  });

  it("truncates output exceeding 100K characters", async () => {
    const longOutput = "x".repeat(150_000);
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return longOutput;
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    const result = await toolDef.handler(
      { repo: "my-repo", args: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.truncated, true);
    assert.ok(parsed.output.includes("TRUNCATED"));
    assert.ok(parsed.output.length < 150_000);
  });

  it("reports shallow=false for non-shallow repos", async () => {
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "500\n";
      return "log output";
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    const result = await toolDef.handler(
      { repo: "my-repo", args: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.shallow, false);
    assert.equal(parsed.availableCommits, 500);
  });

  it("returns error when git operation fails", async () => {
    mockGitRaw.mock.mockImplementation(async () => {
      throw new Error("fatal: bad default revision 'HEAD'");
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    const result = await toolDef.handler(
      { repo: "my-repo", args: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("git log failed"));
    assert.equal(result.isError, true);
  });

  it("handles non-numeric commit count gracefully", async () => {
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "not-a-number\n";
      return "log output";
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    const result = await toolDef.handler(
      { repo: "my-repo", args: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.availableCommits, 0);
  });

  it("only allows access to repos visible to user role", async () => {
    const adminRepo = makeRepo({ name: "admin-only" });
    mockGetVisibleRepos.mock.mockImplementation(() => [adminRepo]);

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx);

    const result = await toolDef.handler(
      { repo: "my-repo", args: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("admin-only"));
    assert.equal(result.isError, true);
  });
});
