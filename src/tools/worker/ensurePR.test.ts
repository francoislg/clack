import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetOctokit = mock.fn<() => Promise<unknown>>();
const mockParseRepoUrl = mock.fn<(url: string) => { owner: string; repo: string }>();

mock.module("../../github.js", {
  namedExports: {
    getOctokit: mockGetOctokit,
    parseRepoUrl: mockParseRepoUrl,
  },
});

const mockFindRepoByName = mock.fn<(...args: unknown[]) => unknown>();
mock.module("../../config.js", {
  namedExports: { findRepoByName: mockFindRepoByName },
});

const mockUpdateActiveChangePrUrl = mock.fn<(...args: unknown[]) => void>();
const mockUpdateActiveChangeStatus = mock.fn<(...args: unknown[]) => void>();
mock.module("../../changes/activeState.js", {
  namedExports: {
    updateActiveChangePrUrl: mockUpdateActiveChangePrUrl,
    updateActiveChangeStatus: mockUpdateActiveChangeStatus,
  },
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

// Import after mocks
const { createEnsurePRTool } = await import("./ensurePR.js");

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
    config: {
      repositories: [
        { name: "my-repo", url: "https://github.com/org/my-repo.git", branch: "main" },
      ],
    } as unknown as WorkerToolContext["config"],
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockGetOctokit.mock.resetCalls();
  mockParseRepoUrl.mock.resetCalls();
  mockFindRepoByName.mock.resetCalls();
  mockUpdateActiveChangePrUrl.mock.resetCalls();
  mockUpdateActiveChangeStatus.mock.resetCalls();
  mockAppendExecutionLog.mock.resetCalls();

  mockFindRepoByName.mock.mockImplementation(() => ({
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    branch: "main",
  }));
  mockParseRepoUrl.mock.mockImplementation(() => ({
    owner: "org",
    repo: "my-repo",
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ensurePR tool", () => {
  beforeEach(resetMocks);

  it("returns error when repository not found in config", async () => {
    mockFindRepoByName.mock.mockImplementation(() => undefined);

    const toolDef = createEnsurePRTool(makeCtx());
    const result = await toolDef.handler(
      { title: "Test PR", summary: "Fix things" },
      { sessionId: "test" }
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.equal(result.isError, true);
  });

  it("returns existing PR when one is already open", async () => {
    const mockList = mock.fn(async () => ({
      data: [{ html_url: "https://github.com/org/my-repo/pull/10" }],
    }));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mock.fn() },
    }));

    const toolDef = createEnsurePRTool(makeCtx());
    const result = await toolDef.handler(
      { title: "Test PR", summary: "Fix things" },
      { sessionId: "test" }
    );

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.pr_url, "https://github.com/org/my-repo/pull/10");
    assert.equal(parsed.created, false);

    // Verify session state was updated
    assert.equal(mockUpdateActiveChangePrUrl.mock.callCount(), 1);
    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 1);
    const statusArgs = mockUpdateActiveChangeStatus.mock.calls[0].arguments as [string, string];
    assert.equal(statusArgs[1], "pr_created");
  });

  it("creates a new PR when none exists", async () => {
    const mockList = mock.fn(async () => ({ data: [] }));
    const mockCreate = mock.fn(async () => ({
      data: { html_url: "https://github.com/org/my-repo/pull/99" },
    }));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const ctx = makeCtx();
    const toolDef = createEnsurePRTool(ctx);
    const result = await toolDef.handler(
      { title: "My PR", summary: "Changes" },
      { sessionId: "test" }
    );

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.pr_url, "https://github.com/org/my-repo/pull/99");
    assert.equal(parsed.created, true);

    // Verify create was called with correct args
    assert.equal(mockCreate.mock.callCount(), 1);
    const createArgs = (mockCreate.mock.calls[0].arguments as unknown as [Record<string, unknown>])[0];
    assert.equal(createArgs.owner, "org");
    assert.equal(createArgs.repo, "my-repo");
    assert.equal(createArgs.title, "My PR");
    assert.equal(createArgs.body, "Changes");
    assert.equal(createArgs.head, ctx.branchName);
    assert.equal(createArgs.base, "main");
  });

  it("handles 422 race condition by re-listing PRs", async () => {
    let listCallCount = 0;
    const mockList = mock.fn(async () => {
      listCallCount++;
      if (listCallCount === 1) {
        return { data: [] };
      }
      return { data: [{ html_url: "https://github.com/org/my-repo/pull/77" }] };
    });

    const mockCreate = mock.fn(async () => {
      const error = new Error("Validation Failed") as Error & { status: number };
      error.status = 422;
      throw error;
    });
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx());
    const result = await toolDef.handler(
      { title: "Race PR", summary: "Race" },
      { sessionId: "test" }
    );

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.pr_url, "https://github.com/org/my-repo/pull/77");
    assert.equal(parsed.created, false);

    // Verify list was called twice (initial + retry)
    assert.equal(mockList.mock.callCount(), 2);
  });

  it("throws when 422 but retry finds no PRs", async () => {
    const mockList = mock.fn(async () => ({ data: [] }));
    const mockCreate = mock.fn(async () => {
      const error = new Error("Validation Failed") as Error & { status: number };
      error.status = 422;
      throw error;
    });
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx());
    const result = await toolDef.handler(
      { title: "Fail PR", summary: "Fail" },
      { sessionId: "test" }
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to ensure PR"));
    assert.equal(result.isError, true);
  });

  it("returns error for non-422 create failures", async () => {
    const mockList = mock.fn(async () => ({ data: [] }));
    const mockCreate = mock.fn(async () => {
      const error = new Error("Server error") as Error & { status: number };
      error.status = 500;
      throw error;
    });
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx());
    const result = await toolDef.handler(
      { title: "Error PR", summary: "Error" },
      { sessionId: "test" }
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to ensure PR"));
    assert.equal(result.isError, true);
  });

  it("uses default branch 'main' when repo config has no branch", async () => {
    mockFindRepoByName.mock.mockImplementation(() => ({
      name: "my-repo",
      url: "https://github.com/org/my-repo.git",
      // no branch property
    }));

    const mockList = mock.fn(async () => ({ data: [] }));
    const mockCreate = mock.fn(async () => ({
      data: { html_url: "https://github.com/org/my-repo/pull/1" },
    }));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx());
    await toolDef.handler(
      { title: "PR", summary: "S" },
      { sessionId: "test" }
    );

    const createArgs = (mockCreate.mock.calls[0].arguments as unknown as [Record<string, unknown>])[0];
    assert.equal(createArgs.base, "main");
  });

  it("logs execution when PR is created", async () => {
    const mockList = mock.fn(async () => ({ data: [] }));
    const mockCreate = mock.fn(async () => ({
      data: { html_url: "https://github.com/org/my-repo/pull/5" },
    }));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const ctx = makeCtx();
    const toolDef = createEnsurePRTool(ctx);
    await toolDef.handler(
      { title: "PR", summary: "S" },
      { sessionId: "test" }
    );

    assert.ok(mockAppendExecutionLog.mock.callCount() >= 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0].arguments as [string, string];
    assert.equal(logArgs[0], ctx.branchName);
    assert.ok(logArgs[1].includes("ensure_pr"));
  });

  it("calls list with correct owner:branch head filter", async () => {
    const mockList = mock.fn(async () => ({
      data: [{ html_url: "https://github.com/org/my-repo/pull/1" }],
    }));
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList },
    }));

    const ctx = makeCtx();
    const toolDef = createEnsurePRTool(ctx);
    await toolDef.handler(
      { title: "PR", summary: "S" },
      { sessionId: "test" }
    );

    const listArgs = (mockList.mock.calls[0].arguments as unknown as [Record<string, unknown>])[0];
    assert.equal(listArgs.head, `org:${ctx.branchName}`);
    assert.equal(listArgs.state, "open");
  });
});
