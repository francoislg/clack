import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createGitPushTool, type GitPushDeps } from "./gitPush.js";
import type { WorkerToolContext } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<WorkerToolContext>): WorkerToolContext {
  return {
    mode: "worker",
    worktreePath: "/tmp/worktrees/my-repo/branch",
    branchName: "clack/fix/my-branch",
    repoName: "my-repo",
    repoUrl: "https://github.com/org/my-repo.git",
    channelId: "C123",
    threadTs: "1.0",
    sessionId: "sess-1",
    config: { repositories: [] } as never as WorkerToolContext["config"],
    ...overrides,
  };
}

interface ToolResult {
  content: Array<{ text: string }>;
  isError?: true;
}

function parseResult(result: ToolResult) {
  return JSON.parse(result.content[0]!.text);
}

function makeDeps() {
  const mockRemote = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => "");
  const mockPush = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => "");
  const mockGetAuthenticatedCloneUrl = mock.fn<(url: string) => Promise<string>>(
    async () => "https://x-access-token:tok@github.com/org/my-repo.git",
  );
  const mockAppendExecutionLog = mock.fn<(...args: unknown[]) => void>();
  const mockSimpleGit = mock.fn(() => ({
    remote: mockRemote,
    push: mockPush,
  }));

  const deps: GitPushDeps = {
    getAuthenticatedCloneUrl:
      mockGetAuthenticatedCloneUrl as never as GitPushDeps["getAuthenticatedCloneUrl"],
    appendExecutionLog: mockAppendExecutionLog as never as GitPushDeps["appendExecutionLog"],
    simpleGit: mockSimpleGit as never as GitPushDeps["simpleGit"],
  };

  return {
    deps,
    mockGetAuthenticatedCloneUrl,
    mockAppendExecutionLog,
    mockSimpleGit,
    mockRemote,
    mockPush,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gitPush tool", () => {
  it("pushes successfully and returns success", async () => {
    const { deps } = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitPushTool(ctx, deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(result.isError, undefined);
  });

  it("sets remote URL before pushing", async () => {
    const { deps, mockRemote, mockPush } = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitPushTool(ctx, deps);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    // Verify remote set-url was called
    assert.equal(mockRemote.mock.callCount(), 1);
    const remoteArgs = mockRemote.mock.calls[0]!.arguments[0] as string[];
    assert.deepEqual(remoteArgs, [
      "set-url",
      "origin",
      "https://x-access-token:tok@github.com/org/my-repo.git",
    ]);

    // Verify push was called with correct args
    assert.equal(mockPush.mock.callCount(), 1);
    const pushArgs = mockPush.mock.calls[0]!.arguments[0] as string[];
    assert.deepEqual(pushArgs, ["-u", "origin", ctx.branchName]);
  });

  it("calls getAuthenticatedCloneUrl with repo URL", async () => {
    const { deps, mockGetAuthenticatedCloneUrl } = makeDeps();
    const ctx = makeCtx({ repoUrl: "https://github.com/acme/widgets.git" });
    const toolDef = createGitPushTool(ctx, deps);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.equal(mockGetAuthenticatedCloneUrl.mock.callCount(), 1);
    const arg = mockGetAuthenticatedCloneUrl.mock.calls[0]!.arguments[0];
    assert.equal(arg, "https://github.com/acme/widgets.git");
  });

  it("logs success on push", async () => {
    const { deps, mockAppendExecutionLog } = makeDeps();
    const ctx = makeCtx();
    const toolDef = createGitPushTool(ctx, deps);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.equal(mockAppendExecutionLog.mock.callCount(), 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0]!.arguments as [string, string];
    assert.equal(logArgs[0], ctx.branchName);
    assert.ok(logArgs[1].includes("git_push"));
    assert.ok(logArgs[1].includes("success"));
  });

  it("returns error when push fails", async () => {
    const { deps, mockPush } = makeDeps();
    mockPush.mock.mockImplementation(async () => {
      throw new Error("Authentication failed");
    });

    const toolDef = createGitPushTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("push failed"));
    assert.ok(parsed.error.includes("Authentication failed"));
    assert.equal(result.isError, true);
  });

  it("logs failure on push error", async () => {
    const { deps, mockPush, mockAppendExecutionLog } = makeDeps();
    mockPush.mock.mockImplementation(async () => {
      throw new Error("hook failed");
    });

    const ctx = makeCtx();
    const toolDef = createGitPushTool(ctx, deps);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.equal(mockAppendExecutionLog.mock.callCount(), 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0]!.arguments as [string, string];
    assert.equal(logArgs[0], ctx.branchName);
    assert.ok(logArgs[1].includes("git_push"));
    assert.ok(logArgs[1].includes("failed"));
  });

  it("returns error when getAuthenticatedCloneUrl fails", async () => {
    const { deps, mockGetAuthenticatedCloneUrl } = makeDeps();
    mockGetAuthenticatedCloneUrl.mock.mockImplementation(async () => {
      throw new Error("Token expired");
    });

    const toolDef = createGitPushTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Token expired"));
    assert.equal(result.isError, true);
  });
});
