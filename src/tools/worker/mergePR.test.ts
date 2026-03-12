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

const mockFindRepoByName = mock.fn<(...args: unknown[]) => unknown>();
mock.module("../../config.js", {
  namedExports: { findRepoByName: mockFindRepoByName },
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
const { createMergePRTool } = await import("./mergePR.js");

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
  mockFindRepoByName.mock.resetCalls();
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
  mockFindRepoByName.mock.mockImplementation(() => ({
    name: "my-repo",
    mergeStrategy: "squash",
  }));
  mockCleanupAfterPRAction.mock.mockImplementation(async () => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mergePR tool", () => {
  beforeEach(resetMocks);

  it("returns error when no session found", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("No active change"));
    assert.equal(result.isError, true);
  });

  it("returns error when session has no activeChange", async () => {
    mockGetSession.mock.mockImplementation(async () => ({ activeChange: null }));

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("No active change"));
    assert.equal(result.isError, true);
  });

  it("returns error when activeChange has no prUrl", async () => {
    mockGetSession.mock.mockImplementation(async () => ({
      activeChange: { prUrl: undefined },
    }));

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("No PR URL"));
    assert.equal(result.isError, true);
  });

  it("returns error when PR URL cannot be parsed", async () => {
    mockParsePrUrl.mock.mockImplementation(() => null);

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("Could not parse PR URL"));
    assert.equal(result.isError, true);
  });

  it("merges PR with squash strategy and returns success", async () => {
    const mockMerge = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => ({}));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.merge_method, "squash");
    assert.equal(parsed.warning, undefined);

    // Verify merge was called correctly
    assert.equal(mockMerge.mock.callCount(), 1);
    const mergeArgs = (mockMerge.mock.calls[0].arguments as unknown as [Record<string, unknown>])[0];
    assert.equal(mergeArgs.owner, "org");
    assert.equal(mergeArgs.repo, "my-repo");
    assert.equal(mergeArgs.pull_number, 42);
    assert.equal(mergeArgs.merge_method, "squash");

    // Verify cleanup was called
    assert.equal(mockCleanupAfterPRAction.mock.callCount(), 1);
  });

  it("uses 'merge' strategy from repo config", async () => {
    mockFindRepoByName.mock.mockImplementation(() => ({
      name: "my-repo",
      mergeStrategy: "merge",
    }));

    const mockMerge = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => ({}));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.merge_method, "merge");

    const mergeArgs = (mockMerge.mock.calls[0].arguments as unknown as [Record<string, unknown>])[0];
    assert.equal(mergeArgs.merge_method, "merge");
  });

  it("defaults to 'squash' when repo config has no mergeStrategy", async () => {
    mockFindRepoByName.mock.mockImplementation(() => ({
      name: "my-repo",
      // no mergeStrategy
    }));

    const mockMerge = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => ({}));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.merge_method, "squash");
  });

  it("defaults to 'squash' when repo not found in config", async () => {
    mockFindRepoByName.mock.mockImplementation(() => undefined);

    const mockMerge = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => ({}));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.merge_method, "squash");
  });

  it("deletes remote branch after merge", async () => {
    const mockMerge = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => ({}));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const ctx = makeCtx();
    const toolDef = createMergePRTool(ctx);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.equal(mockDeleteRef.mock.callCount(), 1);
    const deleteArgs = (mockDeleteRef.mock.calls[0].arguments as unknown as [Record<string, unknown>])[0];
    assert.equal(deleteArgs.owner, "org");
    assert.equal(deleteArgs.repo, "my-repo");
    assert.equal(deleteArgs.ref, `heads/${ctx.branchName}`);
  });

  it("returns warning when branch deletion fails", async () => {
    const mockMerge = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => {
      throw new Error("Reference does not exist");
    });
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.ok(parsed.warning);
    assert.ok(parsed.warning.includes("Failed to delete remote branch"));
    assert.ok(parsed.warning.includes("Reference does not exist"));
  });

  it("returns error when merge fails", async () => {
    const mockMerge = mock.fn(async () => {
      throw new Error("Merge conflict");
    });
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
    }));

    const toolDef = createMergePRTool(makeCtx());
    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("merge failed"));
    assert.ok(parsed.error.includes("Merge conflict"));
    assert.equal(result.isError, true);
  });

  it("logs execution after merge", async () => {
    const mockMerge = mock.fn(async () => ({}));
    const mockDeleteRef = mock.fn(async () => ({}));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { merge: mockMerge },
      git: { deleteRef: mockDeleteRef },
    }));

    const ctx = makeCtx();
    const toolDef = createMergePRTool(ctx);
    await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    assert.ok(mockAppendExecutionLog.mock.callCount() >= 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0].arguments as [string, string];
    assert.equal(logArgs[0], ctx.branchName);
    assert.ok(logArgs[1].includes("squash"));
  });
});
