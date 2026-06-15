import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createGitLogTool, type GitLogDeps } from "./gitLog.js";
import type { QueryToolContext } from "../types.js";
import type { RepositoryConfig } from "../../config.js";
import { parseToolResult } from "../testHelpers.js";

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
    cronUserSchedules: false,
    ...overrides,
  };
}

const mockGitRaw = vi.fn<(...args: unknown[]) => Promise<string>>();

function makeSimpleGit(): GitLogDeps["simpleGit"] {
  return (_opts: { baseDir: string }) => ({ raw: (...args: string[][]) => mockGitRaw(...args) });
}

function makeDeps(overrides: Partial<GitLogDeps> = {}): GitLogDeps {
  return {
    getVisibleRepos: vi.fn((_role: string, _repos: RepositoryConfig[]) => [
      makeRepo(),
    ]) as GitLogDeps["getVisibleRepos"],
    getRepositoriesDir: vi.fn(() => "/data/repositories") as GitLogDeps["getRepositoriesDir"],
    existsSync: vi.fn((_path: string) => true) as GitLogDeps["existsSync"],
    simpleGit: makeSimpleGit(),
    findLocalBranchSource: () => null,
    ...overrides,
  };
}

type GitLogInput = Parameters<ReturnType<typeof createGitLogTool>["handler"]>[0];

function gitInput(overrides: Partial<GitLogInput> = {}): GitLogInput {
  return {
    repo: "my-repo",
    path: undefined,
    limit: undefined,
    since: undefined,
    args: undefined,
    branch: undefined,
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
    mockGitRaw.mockClear();
    mockGitRaw.mockImplementation(defaultGitRaw);
  });

  it("returns error for unknown repository", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(gitInput({ repo: "nonexistent" }), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("my-repo"));
    assert.equal(result.isError, true);
  });

  it("returns error when repo has not been cloned", async () => {
    const deps = makeDeps({
      existsSync: vi.fn((_path: string) => false) as GitLogDeps["existsSync"],
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(gitInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not been cloned"));
    assert.equal(result.isError, true);
  });

  it("returns git log output with metadata", async () => {
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "true\n";
      if (cmdArgs.includes("--count")) return "50\n";
      if (cmdArgs[0] === "log") return "commit abc123\nsome log output\n";
      return "";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(gitInput({ args: ["--oneline", "-n", "5"] }), {
      sessionId: "test",
    });

    const parsed = parseToolResult(result);
    assert.ok(parsed.output.includes("commit abc123"));
    assert.equal(parsed.shallow, true);
    assert.equal(parsed.availableCommits, 50);
    assert.equal(parsed.truncated, undefined);
    assert.equal(result.isError, undefined);
  });

  it("passes user-provided args to git log", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "log output";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler(gitInput({ args: ["--oneline", "--author=John", "-n", "20"] }), {
      sessionId: "test",
    });

    const logCall = rawCalls.find((c) => c[0] === "log");
    assert.ok(logCall);
    assert.ok(logCall!.includes("--oneline"));
    assert.ok(logCall!.includes("--author=John"));
    assert.ok(logCall!.includes("-n"));
    assert.ok(logCall!.includes("20"));
  });

  it("uses empty args array when no args provided", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "log output";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler(gitInput(), { sessionId: "test" });

    const logCall = rawCalls.find((c) => c[0] === "log");
    assert.ok(logCall);
    assert.deepEqual(logCall, ["log"]);
  });

  it("refuses output exceeding the budget with narrowing suggestions", async () => {
    const longOutput = "x".repeat(50_000);
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return longOutput;
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(gitInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("too large"));
    assert.ok(parsed.error.includes("limit"));
    assert.ok(parsed.error.includes("path"));
    assert.equal(parsed.output, undefined);
  });

  it("returns output sized exactly at the budget (boundary, not refused)", async () => {
    const atBudget = "x".repeat(40_000);
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return atBudget;
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(gitInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(result.isError, undefined);
    assert.equal(parsed.output, atBudget);
  });

  it("maps limit, since, and path to git flags (paths last, after --)", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "log output";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler(gitInput({ limit: 5, since: "2026-04-17", path: "src/a.ts" }), {
      sessionId: "test",
    });

    const logCall = rawCalls.find((c) => c[0] === "log");
    assert.ok(logCall);
    assert.deepEqual(logCall, ["log", "-n", "5", "--since=2026-04-17", "--", "src/a.ts"]);
  });

  it("supports an array of paths and composes with raw args", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "log output";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler(gitInput({ limit: 3, args: ["--oneline"], path: ["a.ts", "b.ts"] }), {
      sessionId: "test",
    });

    const logCall = rawCalls.find((c) => c[0] === "log");
    assert.deepEqual(logCall, ["log", "-n", "3", "--oneline", "--", "a.ts", "b.ts"]);
  });

  it("maps each first-class param in isolation", async () => {
    const rawCalls: string[][] = [];
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      rawCalls.push(cmdArgs);
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "100\n";
      return "log output";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler(gitInput({ limit: 5 }), { sessionId: "test" });
    await toolDef.handler(gitInput({ since: "2026-04-17" }), { sessionId: "test" });
    await toolDef.handler(gitInput({ path: "src/a.ts" }), { sessionId: "test" });

    const logCalls = rawCalls.filter((c) => c[0] === "log");
    assert.deepEqual(logCalls[0], ["log", "-n", "5"]);
    assert.deepEqual(logCalls[1], ["log", "--since=2026-04-17"]);
    assert.deepEqual(logCalls[2], ["log", "--", "src/a.ts"]);
  });

  it("reports shallow=false for non-shallow repos", async () => {
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "500\n";
      return "log output";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(gitInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.shallow, false);
    assert.equal(parsed.availableCommits, 500);
  });

  it("returns error when git operation fails", async () => {
    mockGitRaw.mockImplementation(async () => {
      throw new Error("fatal: bad default revision 'HEAD'");
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(gitInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("git log failed"));
    assert.equal(result.isError, true);
  });

  it("handles non-numeric commit count gracefully", async () => {
    mockGitRaw.mockImplementation(async (args: unknown) => {
      const cmdArgs = args as string[];
      if (cmdArgs.includes("--is-shallow-repository")) return "false\n";
      if (cmdArgs.includes("--count")) return "not-a-number\n";
      return "log output";
    });

    const deps = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(gitInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.availableCommits, 0);
  });

  it("only allows access to repos visible to user role", async () => {
    const adminRepo = makeRepo({ name: "admin-only" });
    const deps = makeDeps({
      getVisibleRepos: vi.fn(() => [adminRepo]) as GitLogDeps["getVisibleRepos"],
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    const result = await toolDef.handler(gitInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("admin-only"));
    assert.equal(result.isError, true);
  });

  // -------------------------------------------------------------------------
  // §16: local-worker shortcut
  // -------------------------------------------------------------------------

  it("uses the worker's worktree as baseDir when findLocalBranchSource returns a path", async () => {
    const baseDirs: string[] = [];
    const deps = makeDeps({
      findLocalBranchSource: () => "/data/worktrees/my-repo/worker-1",
      simpleGit: (opts: { baseDir: string }) => {
        baseDirs.push(opts.baseDir);
        return { raw: (...args: string[][]) => mockGitRaw(...args) };
      },
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler(gitInput({ branch: "feat/x" }), { sessionId: "test" });

    assert.deepEqual(baseDirs, ["/data/worktrees/my-repo/worker-1"]);
  });

  it("falls back to the main clone when no worker has the branch", async () => {
    const baseDirs: string[] = [];
    const deps = makeDeps({
      findLocalBranchSource: () => null,
      simpleGit: (opts: { baseDir: string }) => {
        baseDirs.push(opts.baseDir);
        return { raw: (...args: string[][]) => mockGitRaw(...args) };
      },
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler(gitInput({ branch: "feat/x" }), { sessionId: "test" });

    assert.deepEqual(baseDirs, [resolve("/data/repositories", "my-repo")]);
  });

  it("uses the main clone when no branch is provided (no shortcut attempted)", async () => {
    const findCalls: Array<{ repo: string; branch: string }> = [];
    const baseDirs: string[] = [];
    const deps = makeDeps({
      findLocalBranchSource: (repo, branch) => {
        findCalls.push({ repo, branch });
        return "/should/not/be/used";
      },
      simpleGit: (opts: { baseDir: string }) => {
        baseDirs.push(opts.baseDir);
        return { raw: (...args: string[][]) => mockGitRaw(...args) };
      },
    });

    const ctx = makeCtx();
    const toolDef = createGitLogTool(ctx, deps);

    await toolDef.handler(gitInput(), { sessionId: "test" });

    // No branch → no shortcut lookup, uses main clone
    assert.equal(findCalls.length, 0);
    assert.deepEqual(baseDirs, [resolve("/data/repositories", "my-repo")]);
  });
});
