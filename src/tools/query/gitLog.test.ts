import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createGitLogTool, type GitLogDeps } from "./gitLog.js";
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

function makeSimpleGit(): GitLogDeps["simpleGit"] {
  return (_opts: { baseDir: string }) => ({ raw: (...args: string[][]) => mockGitRaw(...args) });
}

function makeDeps(overrides: Partial<GitLogDeps> = {}): GitLogDeps {
  return {
    getVisibleRepos: mock.fn((_role: string, _repos: RepositoryConfig[]) => [
      makeRepo(),
    ]) as GitLogDeps["getVisibleRepos"],
    getRepositoriesDir: mock.fn(() => "/data/repositories") as GitLogDeps["getRepositoriesDir"],
    existsSync: mock.fn((_path: string) => true) as GitLogDeps["existsSync"],
    simpleGit: makeSimpleGit(),
    ...overrides,
  };
}

function defaultGitRaw(args: unknown): Promise<string> {
  const cmdArgs = args as string[];
  if (cmdArgs.includes("--is-shallow-repository")) return Promise.resolve("false\n");
  if (cmdArgs.includes("--count")) return Promise.resolve("100\n");
  return Promise.resolve("commit abc123\nAuthor: test\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gitLog tool", () => {
  beforeEach(() => {
    mockGitRaw.mock.resetCalls();
    mockGitRaw.mock.mockImplementation(defaultGitRaw);
  });

  it("returns error for unknown repository", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

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
    const deps = makeDeps({
      existsSync: mock.fn((_path: string) => false) as GitLogDeps["existsSync"],
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

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

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

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
    const rawCalls: string[][] = [];
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "log output";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler(
      { repo: "my-repo", args: ["--oneline", "--author=John", "-n", "20"] },
      { sessionId: "test" },
    );

    const logCall = rawCalls.find((c) => c[0] === "log");
    assert.ok(logCall);
    assert.ok(logCall!.includes("--oneline"));
    assert.ok(logCall!.includes("--author=John"));
    assert.ok(logCall!.includes("-n"));
    assert.ok(logCall!.includes("20"));
  });

  it("uses empty args array when no args provided", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mock.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "log output";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler({ repo: "my-repo", args: undefined }, { sessionId: "test" });

    const logCall = rawCalls.find((c) => c[0] === "log");
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

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

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

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

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

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

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

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", args: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.availableCommits, 0);
  });

  it("only allows access to repos visible to user role", async () => {
    const adminRepo = makeRepo({ name: "admin-only" });
    const deps = makeDeps({
      getVisibleRepos: mock.fn(() => [adminRepo]) as GitLogDeps["getVisibleRepos"],
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

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
