import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createEnsurePRTool, type EnsurePRDeps } from "./ensurePR.js";
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
    config: {
      repositories: [
        { name: "my-repo", url: "https://github.com/org/my-repo.git", branch: "main" },
      ],
    } as never as WorkerToolContext["config"],
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
  const mockGetOctokit = mock.fn<() => Promise<unknown>>(async () => ({
    pulls: { list: mock.fn(async () => ({ data: [] })), create: mock.fn() },
  }));
  const mockParseRepoUrl = mock.fn<(url: string) => { owner: string; repo: string }>(() => ({
    owner: "org",
    repo: "my-repo",
  }));
  const mockFindRepoByName = mock.fn<(...args: unknown[]) => unknown>(() => ({
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    branch: "main",
  }));
  const mockUpdateActiveChangePrUrl = mock.fn<(...args: unknown[]) => void>();
  const mockUpdateActiveChangeStatus = mock.fn<(...args: unknown[]) => void>();
  const mockAppendExecutionLog = mock.fn<(...args: unknown[]) => void>();

  const deps: EnsurePRDeps = {
    getOctokit: mockGetOctokit as never as EnsurePRDeps["getOctokit"],
    parseRepoUrl: mockParseRepoUrl as never as EnsurePRDeps["parseRepoUrl"],
    findRepoByName: mockFindRepoByName as never as EnsurePRDeps["findRepoByName"],
    updateActiveChangePrUrl:
      mockUpdateActiveChangePrUrl as never as EnsurePRDeps["updateActiveChangePrUrl"],
    updateActiveChangeStatus:
      mockUpdateActiveChangeStatus as never as EnsurePRDeps["updateActiveChangeStatus"],
    appendExecutionLog: mockAppendExecutionLog as never as EnsurePRDeps["appendExecutionLog"],
  };

  return {
    deps,
    mockGetOctokit,
    mockParseRepoUrl,
    mockFindRepoByName,
    mockUpdateActiveChangePrUrl,
    mockUpdateActiveChangeStatus,
    mockAppendExecutionLog,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ensurePR tool", () => {
  it("returns error when repository not found in config", async () => {
    const { deps, mockFindRepoByName } = makeDeps();
    mockFindRepoByName.mock.mockImplementation(() => undefined);

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Test PR", summary: "Fix things" },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.equal(result.isError, true);
  });

  it("returns existing PR when one is already open", async () => {
    const mockList = mock.fn(async () => ({
      data: [{ number: 10, html_url: "https://github.com/org/my-repo/pull/10" }],
    }));
    const { deps, mockGetOctokit, mockUpdateActiveChangePrUrl, mockUpdateActiveChangeStatus } =
      makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mock.fn(), update: mock.fn() },
    }));

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Test PR", summary: "Fix things" },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.pr_url, "https://github.com/org/my-repo/pull/10");
    assert.equal(parsed.created, false);

    // Verify session state was updated
    assert.equal(mockUpdateActiveChangePrUrl.mock.callCount(), 1);
    assert.equal(mockUpdateActiveChangeStatus.mock.callCount(), 1);
    const statusArgs = mockUpdateActiveChangeStatus.mock.calls[0]!.arguments as [string, string];
    assert.equal(statusArgs[1], "pr_created");
  });

  it("creates a new PR when none exists", async () => {
    const mockList = mock.fn(async () => ({ data: [] }));
    const mockCreate = mock.fn(async () => ({
      data: { html_url: "https://github.com/org/my-repo/pull/99" },
    }));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const ctx = makeCtx();
    const toolDef = createEnsurePRTool(ctx, deps);
    const result = await toolDef.handler(
      { title: "My PR", summary: "Changes" },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.pr_url, "https://github.com/org/my-repo/pull/99");
    assert.equal(parsed.created, true);

    // Verify create was called with correct args
    assert.equal(mockCreate.mock.callCount(), 1);
    const createArgs = mockCreate.mock.calls[0]!.arguments as never as [
      { owner: string; repo: string; title: string; body: string; head: string; base: string },
    ];
    assert.equal(createArgs[0].owner, "org");
    assert.equal(createArgs[0].repo, "my-repo");
    assert.equal(createArgs[0].title, "My PR");
    assert.equal(createArgs[0].body, "Changes");
    assert.equal(createArgs[0].head, ctx.branchName);
    assert.equal(createArgs[0].base, "main");
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
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Race PR", summary: "Race" },
      { sessionId: "test" },
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
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Fail PR", summary: "Fail" },
      { sessionId: "test" },
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
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Error PR", summary: "Error" },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to ensure PR"));
    assert.equal(result.isError, true);
  });

  it("uses default branch 'main' when repo config has no branch", async () => {
    const { deps, mockFindRepoByName, mockGetOctokit } = makeDeps();
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

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    await toolDef.handler({ title: "PR", summary: "S" }, { sessionId: "test" });

    const createArgs = mockCreate.mock.calls[0]!.arguments as never as [{ base: string }];
    assert.equal(createArgs[0].base, "main");
  });

  it("logs execution when PR is created", async () => {
    const mockList = mock.fn(async () => ({ data: [] }));
    const mockCreate = mock.fn(async () => ({
      data: { html_url: "https://github.com/org/my-repo/pull/5" },
    }));
    const { deps, mockGetOctokit, mockAppendExecutionLog } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const ctx = makeCtx();
    const toolDef = createEnsurePRTool(ctx, deps);
    await toolDef.handler({ title: "PR", summary: "S" }, { sessionId: "test" });

    assert.ok(mockAppendExecutionLog.mock.callCount() >= 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0]!.arguments as [string, string];
    assert.equal(logArgs[0], ctx.branchName);
    assert.ok(logArgs[1].includes("ensure_pr"));
  });

  it("calls list with correct owner:branch head filter", async () => {
    const mockList = mock.fn(async () => ({
      data: [{ html_url: "https://github.com/org/my-repo/pull/1" }],
    }));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mock.mockImplementation(async () => ({
      pulls: { list: mockList },
    }));

    const ctx = makeCtx();
    const toolDef = createEnsurePRTool(ctx, deps);
    await toolDef.handler({ title: "PR", summary: "S" }, { sessionId: "test" });

    const listArgs = mockList.mock.calls[0]!.arguments as never as [
      { head: string; state: string },
    ];
    assert.equal(listArgs[0].head, `org:${ctx.branchName}`);
    assert.equal(listArgs[0].state, "open");
  });
});
