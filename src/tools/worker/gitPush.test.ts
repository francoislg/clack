import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createGitPushTool, type GitPushDeps } from "./gitPush.js";
import type { WorkerToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";
import type { VerificationConfig } from "../../changes/verification/config.js";
import type { GateRunResult } from "../../changes/verification/runner.js";
import type { ActiveChangeState } from "../../changes/activeState.js";

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

interface MakeDepsOptions {
  verificationConfig?: VerificationConfig | null;
  gateResult?: GateRunResult;
  activeChange?: ActiveChangeState;
}

function makeDeps(opts: MakeDepsOptions = {}) {
  const mockRemote = mock.fn<(args: string[]) => Promise<void>>(async () => undefined);
  const mockPush = mock.fn<(args: string[]) => Promise<void>>(async () => undefined);
  const mockGetAuthenticatedCloneUrl = mock.fn<GitPushDeps["getAuthenticatedCloneUrl"]>(
    async () => "https://x-access-token:tok@github.com/org/my-repo.git",
  );
  const mockAppendExecutionLog = mock.fn<GitPushDeps["appendExecutionLog"]>();
  const mockSimpleGit = mock.fn<GitPushDeps["simpleGit"]>(() => ({
    remote: mockRemote,
    push: mockPush,
  }));
  const mockLoadConfig = mock.fn<GitPushDeps["loadVerificationConfig"]>(
    () => opts.verificationConfig ?? null,
  );
  const mockRunChecks = mock.fn<GitPushDeps["runVerificationChecks"]>(
    async () => opts.gateResult ?? { result: "pass", checks: [] },
  );
  const mockGetActiveChange = mock.fn<GitPushDeps["getActiveChange"]>(() => opts.activeChange);

  const deps: GitPushDeps = {
    getAuthenticatedCloneUrl: mockGetAuthenticatedCloneUrl,
    appendExecutionLog: mockAppendExecutionLog,
    simpleGit: mockSimpleGit,
    loadVerificationConfig: mockLoadConfig,
    runVerificationChecks: mockRunChecks,
    getActiveChange: mockGetActiveChange,
  };

  return {
    deps,
    mockGetAuthenticatedCloneUrl,
    mockAppendExecutionLog,
    mockSimpleGit,
    mockRemote,
    mockPush,
    mockLoadConfig,
    mockRunChecks,
    mockGetActiveChange,
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

    const parsed = parseToolResult(result);
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

    const parsed = parseToolResult(result);
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

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Token expired"));
    assert.equal(result.isError, true);
  });
});

describe("gitPush verification gate", () => {
  function makeActiveChange(overrides: Partial<ActiveChangeState> = {}): ActiveChangeState {
    return {
      branch: "clack/fix/my-branch",
      repo: "my-repo",
      description: "test",
      status: "executing",
      startedAt: new Date(),
      lastActivityAt: new Date(),
      ...overrides,
    };
  }

  it("does not run checks when config is null", async () => {
    const { deps, mockRunChecks, mockPush } = makeDeps({
      verificationConfig: null,
    });
    const toolDef = createGitPushTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(mockRunChecks.mock.callCount(), 0);
    assert.equal(mockPush.mock.callCount(), 1);
  });

  it("does not run checks when config has an empty checks array", async () => {
    const { deps, mockRunChecks, mockPush } = makeDeps({
      verificationConfig: { checks: [], retryBudget: 3 },
    });
    const toolDef = createGitPushTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(mockRunChecks.mock.callCount(), 0);
    assert.equal(mockPush.mock.callCount(), 1);
  });

  it("pushes when gate passes", async () => {
    const { deps, mockRunChecks, mockPush } = makeDeps({
      verificationConfig: {
        checks: [{ name: "t", command: "echo", timeoutSeconds: 5 }],
        retryBudget: 3,
      },
      gateResult: { result: "pass", checks: [] },
    });
    const toolDef = createGitPushTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(mockRunChecks.mock.callCount(), 1);
    assert.equal(mockPush.mock.callCount(), 1);
  });

  it("returns failure and does not push when gate fails within budget", async () => {
    const active = makeActiveChange();
    const { deps, mockPush } = makeDeps({
      verificationConfig: {
        checks: [{ name: "typecheck", command: "tsc", timeoutSeconds: 5 }],
        retryBudget: 3,
      },
      gateResult: {
        result: "fail",
        checks: [],
        failure: {
          result: "fail",
          checkName: "typecheck",
          exitCode: 1,
          output: "some error",
          durationMs: 42,
          timedOut: false,
        },
      },
      activeChange: active,
    });
    const toolDef = createGitPushTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("typecheck"));
    assert.ok(parsed.error.includes("some error"));
    assert.ok(parsed.error.includes("2 retry attempts remaining"));
    assert.equal(mockPush.mock.callCount(), 0);
    assert.equal(active.verificationAttempts, 1);
  });

  it("returns terminal failure when gate fails and budget is exhausted", async () => {
    const active = makeActiveChange({ verificationAttempts: 2 });
    const { deps, mockPush } = makeDeps({
      verificationConfig: {
        checks: [{ name: "typecheck", command: "tsc", timeoutSeconds: 5 }],
        retryBudget: 3,
      },
      gateResult: {
        result: "fail",
        checks: [],
        failure: {
          result: "fail",
          checkName: "typecheck",
          exitCode: 1,
          output: "still broken",
          durationMs: 42,
          timedOut: false,
        },
      },
      activeChange: active,
    });
    const toolDef = createGitPushTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("budget exhausted"));
    assert.ok(parsed.error.includes("Do not attempt git_push again"));
    assert.equal(mockPush.mock.callCount(), 0);
    assert.equal(active.verificationAttempts, 3);
  });

  it("surfaces push errors normally when gate passes", async () => {
    const { deps, mockPush } = makeDeps({
      verificationConfig: {
        checks: [{ name: "t", command: "echo", timeoutSeconds: 5 }],
        retryBudget: 3,
      },
      gateResult: { result: "pass", checks: [] },
    });
    mockPush.mock.mockImplementation(async () => {
      throw new Error("remote rejected");
    });
    const toolDef = createGitPushTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("push failed"));
    assert.ok(parsed.error.includes("remote rejected"));
  });

  it("uses the worktree path and check list from the context/config", async () => {
    const config: VerificationConfig = {
      checks: [{ name: "t", command: "echo hello", timeoutSeconds: 5 }],
      retryBudget: 3,
    };
    const { deps, mockRunChecks } = makeDeps({
      verificationConfig: config,
      gateResult: { result: "pass", checks: [] },
    });
    const ctx = makeCtx({
      worktreePath: "/custom/wt",
      branchName: "some-branch",
    });
    const toolDef = createGitPushTool(ctx, deps);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.equal(mockRunChecks.mock.callCount(), 1);
    const call = mockRunChecks.mock.calls[0]!.arguments[0];
    assert.equal(call.worktreePath, "/custom/wt");
    assert.equal(call.branchName, "some-branch");
    assert.equal(call.checks.length, 1);
    assert.equal(call.checks[0]!.command, "echo hello");
  });
});
