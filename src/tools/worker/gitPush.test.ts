import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetAuthenticatedCloneUrl = mock.fn<(url: string) => Promise<string>>();
mock.module("../../github.js", {
  namedExports: { getAuthenticatedCloneUrl: mockGetAuthenticatedCloneUrl },
});

const mockAppendExecutionLog = mock.fn<(...args: unknown[]) => void>();
mock.module("../../changes/persistence.js", {
  namedExports: { appendExecutionLog: mockAppendExecutionLog },
});

mock.module("../../errors.js", {
  namedExports: {
    errorMessage: (err: unknown) =>
      err instanceof Error ? err.message : String(err),
  },
});

const mockRemote = mock.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPush = mock.fn<(...args: unknown[]) => Promise<unknown>>();

mock.module("simple-git", {
  namedExports: {
    simpleGit: () => ({
      remote: mockRemote,
      push: mockPush,
    }),
  },
});

// Import after mocks
const { createGitPushTool } = await import("./gitPush.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { WorkerToolContext } from "../types.js";

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
    config: { repositories: [] } as unknown as WorkerToolContext["config"],
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockGetAuthenticatedCloneUrl.mock.resetCalls();
  mockAppendExecutionLog.mock.resetCalls();
  mockRemote.mock.resetCalls();
  mockPush.mock.resetCalls();

  mockGetAuthenticatedCloneUrl.mock.mockImplementation(
    async () => "https://x-access-token:tok@github.com/org/my-repo.git"
  );
  mockRemote.mock.mockImplementation(async () => "");
  mockPush.mock.mockImplementation(async () => "");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gitPush tool", () => {
  beforeEach(resetMocks);

  it("pushes successfully and returns success", async () => {
    const ctx = makeCtx();
    const toolDef = createGitPushTool(ctx);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(result.isError, undefined);
  });

  it("sets remote URL before pushing", async () => {
    const ctx = makeCtx();
    const toolDef = createGitPushTool(ctx);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    // Verify remote set-url was called
    assert.equal(mockRemote.mock.callCount(), 1);
    const remoteArgs = mockRemote.mock.calls[0].arguments[0] as string[];
    assert.deepEqual(remoteArgs, [
      "set-url",
      "origin",
      "https://x-access-token:tok@github.com/org/my-repo.git",
    ]);

    // Verify push was called with correct args
    assert.equal(mockPush.mock.callCount(), 1);
    const pushArgs = mockPush.mock.calls[0].arguments[0] as string[];
    assert.deepEqual(pushArgs, ["-u", "origin", ctx.branchName]);
  });

  it("calls getAuthenticatedCloneUrl with repo URL", async () => {
    const ctx = makeCtx({ repoUrl: "https://github.com/acme/widgets.git" });
    const toolDef = createGitPushTool(ctx);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.equal(mockGetAuthenticatedCloneUrl.mock.callCount(), 1);
    const arg = mockGetAuthenticatedCloneUrl.mock.calls[0].arguments[0];
    assert.equal(arg, "https://github.com/acme/widgets.git");
  });

  it("logs success on push", async () => {
    const ctx = makeCtx();
    const toolDef = createGitPushTool(ctx);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.equal(mockAppendExecutionLog.mock.callCount(), 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0].arguments as [string, string];
    assert.equal(logArgs[0], ctx.branchName);
    assert.ok(logArgs[1].includes("git_push"));
    assert.ok(logArgs[1].includes("success"));
  });

  it("returns error when push fails", async () => {
    mockPush.mock.mockImplementation(async () => {
      throw new Error("Authentication failed");
    });

    const toolDef = createGitPushTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("push failed"));
    assert.ok(parsed.error.includes("Authentication failed"));
    assert.equal(result.isError, true);
  });

  it("logs failure on push error", async () => {
    mockPush.mock.mockImplementation(async () => {
      throw new Error("hook failed");
    });

    const ctx = makeCtx();
    const toolDef = createGitPushTool(ctx);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.equal(mockAppendExecutionLog.mock.callCount(), 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0].arguments as [string, string];
    assert.equal(logArgs[0], ctx.branchName);
    assert.ok(logArgs[1].includes("git_push"));
    assert.ok(logArgs[1].includes("failed"));
  });

  it("returns error when getAuthenticatedCloneUrl fails", async () => {
    mockGetAuthenticatedCloneUrl.mock.mockImplementation(async () => {
      throw new Error("Token expired");
    });

    const toolDef = createGitPushTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Token expired"));
    assert.equal(result.isError, true);
  });
});
