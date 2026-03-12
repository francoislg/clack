import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetSession = mock.fn<(...args: unknown[]) => Promise<unknown>>();
mock.module("../../sessions.js", {
  namedExports: { getSession: mockGetSession },
});

const mockGetOctokit = mock.fn<() => Promise<unknown>>();
mock.module("../../github.js", {
  namedExports: { getOctokit: mockGetOctokit },
});

const mockParsePrUrl = mock.fn<(url: string) => unknown>();
mock.module("../../changes/pr.js", {
  namedExports: { parsePrUrl: mockParsePrUrl },
});

const mockAppendExecutionLog = mock.fn<(...args: unknown[]) => void>();
mock.module("../../changes/persistence.js", {
  namedExports: { appendExecutionLog: mockAppendExecutionLog },
});

const mockCleanupAfterPRAction = mock.fn<(...args: unknown[]) => Promise<void>>();
mock.module("./prHelpers.js", {
  namedExports: { cleanupAfterPRAction: mockCleanupAfterPRAction },
});

mock.module("../../errors.js", {
  namedExports: {
    errorMessage: (err: unknown) =>
      err instanceof Error ? err.message : String(err),
  },
});

// Import after mocks
const { createClosePRTool } = await import("./closePR.js");

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
  mockGetSession.mock.resetCalls();
  mockGetOctokit.mock.resetCalls();
  mockParsePrUrl.mock.resetCalls();
  mockAppendExecutionLog.mock.resetCalls();
  mockCleanupAfterPRAction.mock.resetCalls();

  mockGetSession.mock.mockImplementation(async () => ({
    activeChange: { prUrl: "https://github.com/org/my-repo/pull/42" },
  }));
  mockParsePrUrl.mock.mockImplementation(() => ({
    owner: "org",
    repo: "my-repo",
    pullNumber: 42,
  }));
  mockCleanupAfterPRAction.mock.mockImplementation(async () => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("closePR tool", () => {
  beforeEach(resetMocks);

  it("returns error when no session found", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const toolDef = createClosePRTool(makeCtx());
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("No active change"));
    assert.equal(result.isError, true);
  });

  it("returns error when session has no activeChange", async () => {
    mockGetSession.mock.mockImplementation(async () => ({ activeChange: null }));

    const toolDef = createClosePRTool(makeCtx());
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("No active change"));
    assert.equal(result.isError, true);
  });

  it("returns error when activeChange has no prUrl", async () => {
    mockGetSession.mock.mockImplementation(async () => ({
      activeChange: { prUrl: undefined },
    }));

    const toolDef = createClosePRTool(makeCtx());
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("No PR URL"));
    assert.equal(result.isError, true);
  });

  it("returns error when PR URL cannot be parsed", async () => {
    mockParsePrUrl.mock.mockImplementation(() => null);

    const toolDef = createClosePRTool(makeCtx());
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("Could not parse PR URL"));
    assert.equal(result.isError, true);
  });

  it("closes PR and returns success without branch deletion", async () => {
    const mockUpdate = mock.fn(async () => ({}));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { update: mockUpdate },
      git: { deleteRef: mock.fn() },
    }));

    const toolDef = createClosePRTool(makeCtx());
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.branch_deleted, false);
    assert.equal(parsed.warning, undefined);

    // Verify PR was closed
    assert.equal(mockUpdate.mock.callCount(), 1);
    const callArgs = (mockUpdate.mock.calls[0].arguments as unknown as [Record<string, unknown>])[0];
    assert.equal(callArgs.owner, "org");
    assert.equal(callArgs.repo, "my-repo");
    assert.equal(callArgs.pull_number, 42);
    assert.equal(callArgs.state, "closed");

    // Verify cleanup was called
    assert.equal(mockCleanupAfterPRAction.mock.callCount(), 1);
  });

  it("closes PR and deletes remote branch when delete_branch is true", async () => {
    const mockUpdate = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => ({}));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { update: mockUpdate },
      git: { deleteRef: mockDeleteRef },
    }));

    const ctx = makeCtx();
    const toolDef = createClosePRTool(ctx);
    const result = await toolDef.handler({ delete_branch: true }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.branch_deleted, true);

    // Verify branch deletion was called
    assert.equal(mockDeleteRef.mock.callCount(), 1);
    const deleteArgs = (mockDeleteRef.mock.calls[0].arguments as unknown as [Record<string, unknown>])[0];
    assert.equal(deleteArgs.owner, "org");
    assert.equal(deleteArgs.repo, "my-repo");
    assert.equal(deleteArgs.ref, `heads/${ctx.branchName}`);
  });

  it("returns warning when branch deletion fails", async () => {
    const mockUpdate = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => {
      throw new Error("ref not found");
    });
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { update: mockUpdate },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createClosePRTool(makeCtx());
    const result = await toolDef.handler({ delete_branch: true }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.branch_deleted, false);
    assert.ok(parsed.warning);
    assert.ok(parsed.warning.includes("ref not found"));
  });

  it("returns error when pulls.update throws", async () => {
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: {
        update: mock.fn(async () => {
          throw new Error("API error");
        }),
      },
    }));

    const toolDef = createClosePRTool(makeCtx());
    const result = await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to close PR"));
    assert.ok(parsed.error.includes("API error"));
    assert.equal(result.isError, true);
  });

  it("logs execution when PR is closed", async () => {
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { update: mock.fn(async () => ({})) },
    }));

    const ctx = makeCtx();
    const toolDef = createClosePRTool(ctx);
    await toolDef.handler({ delete_branch: undefined }, { sessionId: "test" });

    assert.ok(mockAppendExecutionLog.mock.callCount() >= 1);
    const firstCallArgs = mockAppendExecutionLog.mock.calls[0].arguments as [string, string];
    assert.equal(firstCallArgs[0], ctx.branchName);
    assert.ok(firstCallArgs[1].includes("close_pr"));
  });
});
