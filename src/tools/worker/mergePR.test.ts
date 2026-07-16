import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createMergePRTool, type MergePRDeps } from "./mergePR.js";
import type { WorkerToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";

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

function makeDeps() {
  const mockGetSession = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    activeChange: { prUrl: "https://github.com/org/my-repo/pull/42" },
  }));
  const mockGetOctokit = vi.fn<() => Promise<unknown>>(async () => ({
    pulls: { merge: vi.fn(async () => ({})) },
    git: { deleteRef: vi.fn(async () => ({})) },
  }));
  const mockParsePrUrl = vi.fn<(url: string) => unknown>(() => ({
    owner: "org",
    repo: "my-repo",
    pullNumber: 42,
  }));
  const mockFindRepoByName = vi.fn<(...args: unknown[]) => unknown>(() => ({
    name: "my-repo",
    mergeStrategy: "squash",
  }));
  const mockAppendExecutionLog = vi.fn<(...args: unknown[]) => void>();
  const mockCleanupAfterPRAction = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

  const deps: MergePRDeps = {
    getSession: mockGetSession as never as MergePRDeps["getSession"],
    getOctokit: mockGetOctokit as never as MergePRDeps["getOctokit"],
    parsePrUrl: mockParsePrUrl as never as MergePRDeps["parsePrUrl"],
    findRepoByName: mockFindRepoByName as never as MergePRDeps["findRepoByName"],
    appendExecutionLog: mockAppendExecutionLog as never as MergePRDeps["appendExecutionLog"],
    cleanupAfterPRAction: mockCleanupAfterPRAction as never as MergePRDeps["cleanupAfterPRAction"],
  };

  return {
    deps,
    mockGetSession,
    mockGetOctokit,
    mockParsePrUrl,
    mockFindRepoByName,
    mockAppendExecutionLog,
    mockCleanupAfterPRAction,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mergePR tool", () => {
  it("returns error when no session found", async () => {
    const { deps, mockGetSession } = makeDeps();
    mockGetSession.mockImplementation(async () => null);

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("No active change"));
    assert.equal(result.isError, true);
  });

  it("returns error when session has no activeChange", async () => {
    const { deps, mockGetSession } = makeDeps();
    mockGetSession.mockImplementation(async () => ({ activeChange: null }));

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("No active change"));
    assert.equal(result.isError, true);
  });

  it("returns error when activeChange has no prUrl", async () => {
    const { deps, mockGetSession } = makeDeps();
    mockGetSession.mockImplementation(async () => ({
      activeChange: { prUrl: undefined },
    }));

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("No PR URL"));
    assert.equal(result.isError, true);
  });

  it("returns error when PR URL cannot be parsed", async () => {
    const { deps, mockParsePrUrl } = makeDeps();
    mockParsePrUrl.mockImplementation(() => null);

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("Could not parse PR URL"));
    assert.equal(result.isError, true);
  });

  it("merges PR with squash strategy and returns success", async () => {
    const mockMerge = vi.fn(async () => ({}));
    const mockDeleteRef = vi.fn(async () => ({}));
    const { deps, mockGetOctokit, mockCleanupAfterPRAction } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.merge_method, "squash");
    assert.equal(parsed.warning, undefined);

    // Verify merge was called correctly
    assert.equal(mockMerge.mock.calls.length, 1);
    const mergeArgs = mockMerge.mock.calls[0]! as never as [
      { owner: string; repo: string; pull_number: number; merge_method: string },
    ];
    assert.equal(mergeArgs[0].owner, "org");
    assert.equal(mergeArgs[0].repo, "my-repo");
    assert.equal(mergeArgs[0].pull_number, 42);
    assert.equal(mergeArgs[0].merge_method, "squash");

    // Verify cleanup was called
    assert.equal(mockCleanupAfterPRAction.mock.calls.length, 1);
  });

  it("uses 'merge' strategy from repo config", async () => {
    const mockMerge = vi.fn(async () => ({}));
    const mockDeleteRef = vi.fn(async () => ({}));
    const { deps, mockFindRepoByName, mockGetOctokit } = makeDeps();
    mockFindRepoByName.mockImplementation(() => ({
      name: "my-repo",
      mergeStrategy: "merge",
    }));
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.merge_method, "merge");

    const mergeArgs = mockMerge.mock.calls[0]! as never as [{ merge_method: string }];
    assert.equal(mergeArgs[0].merge_method, "merge");
  });

  it("defaults to 'squash' when repo config has no mergeStrategy", async () => {
    const mockMerge = vi.fn(async () => ({}));
    const mockDeleteRef = vi.fn(async () => ({}));
    const { deps, mockFindRepoByName, mockGetOctokit } = makeDeps();
    mockFindRepoByName.mockImplementation(() => ({
      name: "my-repo",
      // no mergeStrategy
    }));
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.merge_method, "squash");
  });

  it("defaults to 'squash' when repo not found in config", async () => {
    const mockMerge = vi.fn(async () => ({}));
    const mockDeleteRef = vi.fn(async () => ({}));
    const { deps, mockFindRepoByName, mockGetOctokit } = makeDeps();
    mockFindRepoByName.mockImplementation(() => undefined);
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.merge_method, "squash");
  });

  it("deletes remote branch after merge", async () => {
    const mockMerge = vi.fn(async () => ({}));
    const mockDeleteRef = vi.fn(async () => ({}));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const ctx = makeCtx();
    const toolDef = createMergePRTool(ctx, deps);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.equal(mockDeleteRef.mock.calls.length, 1);
    const deleteArgs = mockDeleteRef.mock.calls[0]! as never as [
      { owner: string; repo: string; ref: string },
    ];
    assert.equal(deleteArgs[0].owner, "org");
    assert.equal(deleteArgs[0].repo, "my-repo");
    assert.equal(deleteArgs[0].ref, `heads/${ctx.branchName}`);
  });

  it("returns warning when branch deletion fails", async () => {
    const mockMerge = vi.fn(async () => ({}));
    const mockDeleteRef = vi.fn(async () => {
      throw new Error("Reference does not exist");
    });
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.ok(parsed.warning);
    assert.ok(parsed.warning.includes("Failed to delete remote branch"));
    assert.ok(parsed.warning.includes("Reference does not exist"));
  });

  it("returns error when merge fails", async () => {
    const mockMerge = vi.fn(async () => {
      throw new Error("Merge conflict");
    });
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
    }));

    const toolDef = createMergePRTool(makeCtx(), deps);
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("merge failed"));
    assert.ok(parsed.error.includes("Merge conflict"));
    assert.equal(result.isError, true);
  });

  it("logs execution after merge", async () => {
    const mockMerge = vi.fn(async () => ({}));
    const mockDeleteRef = vi.fn(async () => ({}));
    const { deps, mockGetOctokit, mockAppendExecutionLog } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const ctx = makeCtx();
    const toolDef = createMergePRTool(ctx, deps);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.ok(mockAppendExecutionLog.mock.calls.length >= 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0]! as [string, string];
    assert.equal(logArgs[0], ctx.branchName);
    assert.ok(logArgs[1].includes("squash"));
  });
});
