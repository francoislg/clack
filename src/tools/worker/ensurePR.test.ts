import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createEnsurePRTool, type EnsurePRDeps } from "./ensurePR.js";
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
    config: {
      repositories: [
        { name: "my-repo", url: "https://github.com/org/my-repo.git", branch: "main" },
      ],
    } as never as WorkerToolContext["config"],
    ...overrides,
  };
}

function makeDeps() {
  const mockGetOctokit = vi.fn<() => Promise<unknown>>(async () => ({
    pulls: { list: vi.fn(async () => ({ data: [] })), create: vi.fn() },
  }));
  const mockParseRepoUrl = vi.fn<(url: string) => { owner: string; repo: string }>(() => ({
    owner: "org",
    repo: "my-repo",
  }));
  const mockFindRepoByName = vi.fn<(...args: unknown[]) => unknown>(() => ({
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    branch: "main",
  }));
  const mockUpdateActiveChangePrUrl = vi.fn<(...args: unknown[]) => void>();
  const mockUpdateActiveChangeStatus = vi.fn<(...args: unknown[]) => void>();
  const mockAppendExecutionLog = vi.fn<(...args: unknown[]) => void>();

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
    mockFindRepoByName.mockImplementation(() => undefined);

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Test PR", summary: "Fix things", reviewers: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.equal(result.isError, true);
  });

  it("returns existing PR when one is already open", async () => {
    const mockList = vi.fn(async () => ({
      data: [{ number: 10, html_url: "https://github.com/org/my-repo/pull/10" }],
    }));
    const { deps, mockGetOctokit, mockUpdateActiveChangePrUrl, mockUpdateActiveChangeStatus } =
      makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: vi.fn(), update: vi.fn() },
    }));

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Test PR", summary: "Fix things", reviewers: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.pr_url, "https://github.com/org/my-repo/pull/10");
    assert.equal(parsed.created, false);

    // Verify session state was updated
    assert.equal(mockUpdateActiveChangePrUrl.mock.calls.length, 1);
    assert.equal(mockUpdateActiveChangeStatus.mock.calls.length, 1);
    const statusArgs = mockUpdateActiveChangeStatus.mock.calls[0]! as [string, string];
    assert.equal(statusArgs[1], "pr_created");
  });

  it("creates a new PR when none exists", async () => {
    const mockList = vi.fn(async () => ({ data: [] }));
    const mockCreate = vi.fn(async () => ({
      data: { html_url: "https://github.com/org/my-repo/pull/99" },
    }));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const ctx = makeCtx();
    const toolDef = createEnsurePRTool(ctx, deps);
    const result = await toolDef.handler(
      { title: "My PR", summary: "Changes", reviewers: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.pr_url, "https://github.com/org/my-repo/pull/99");
    assert.equal(parsed.created, true);

    // Verify create was called with correct args
    assert.equal(mockCreate.mock.calls.length, 1);
    const createArgs = mockCreate.mock.calls[0]! as never as [
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
    const mockList = vi.fn(async () => {
      listCallCount++;
      if (listCallCount === 1) {
        return { data: [] };
      }
      return { data: [{ html_url: "https://github.com/org/my-repo/pull/77" }] };
    });

    const mockCreate = vi.fn(async () => {
      const error = new Error("Validation Failed") as Error & { status: number };
      error.status = 422;
      throw error;
    });
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Race PR", summary: "Race", reviewers: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.pr_url, "https://github.com/org/my-repo/pull/77");
    assert.equal(parsed.created, false);

    // Verify list was called twice (initial + retry)
    assert.equal(mockList.mock.calls.length, 2);
  });

  it("throws when 422 but retry finds no PRs", async () => {
    const mockList = vi.fn(async () => ({ data: [] }));
    const mockCreate = vi.fn(async () => {
      const error = new Error("Validation Failed") as Error & { status: number };
      error.status = 422;
      throw error;
    });
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Fail PR", summary: "Fail", reviewers: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to ensure PR"));
    assert.equal(result.isError, true);
  });

  it("returns error for non-422 create failures", async () => {
    const mockList = vi.fn(async () => ({ data: [] }));
    const mockCreate = vi.fn(async () => {
      const error = new Error("Server error") as Error & { status: number };
      error.status = 500;
      throw error;
    });
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    const result = await toolDef.handler(
      { title: "Error PR", summary: "Error", reviewers: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to ensure PR"));
    assert.equal(result.isError, true);
  });

  it("uses default branch 'main' when repo config has no branch", async () => {
    const { deps, mockFindRepoByName, mockGetOctokit } = makeDeps();
    mockFindRepoByName.mockImplementation(() => ({
      name: "my-repo",
      url: "https://github.com/org/my-repo.git",
      // no branch property
    }));

    const mockList = vi.fn(async () => ({ data: [] }));
    const mockCreate = vi.fn(async () => ({
      data: { html_url: "https://github.com/org/my-repo/pull/1" },
    }));
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const toolDef = createEnsurePRTool(makeCtx(), deps);
    await toolDef.handler(
      { title: "PR", summary: "S", reviewers: undefined },
      { sessionId: "test" },
    );

    const createArgs = mockCreate.mock.calls[0]! as never as [{ base: string }];
    assert.equal(createArgs[0].base, "main");
  });

  it("logs execution when PR is created", async () => {
    const mockList = vi.fn(async () => ({ data: [] }));
    const mockCreate = vi.fn(async () => ({
      data: { html_url: "https://github.com/org/my-repo/pull/5" },
    }));
    const { deps, mockGetOctokit, mockAppendExecutionLog } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate },
    }));

    const ctx = makeCtx();
    const toolDef = createEnsurePRTool(ctx, deps);
    await toolDef.handler(
      { title: "PR", summary: "S", reviewers: undefined },
      { sessionId: "test" },
    );

    assert.ok(mockAppendExecutionLog.mock.calls.length >= 1);
    const logArgs = mockAppendExecutionLog.mock.calls[0]! as [string, string];
    assert.equal(logArgs[0], ctx.branchName);
    assert.ok(logArgs[1].includes("ensure_pr"));
  });

  it("requests reviewers (author excluded, case-insensitive) on a new PR when the flag is on", async () => {
    const mockList = vi.fn(async () => ({ data: [] }));
    const mockCreate = vi.fn(async () => ({
      data: { number: 42, html_url: "https://github.com/org/my-repo/pull/42" },
    }));
    const mockRequestReviewers = vi.fn<
      (args: { pull_number: number; reviewers: string[] }) => Promise<object>
    >(async () => ({}));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate, requestReviewers: mockRequestReviewers },
    }));

    const ctx = makeCtx({ requirePRReviewers: true, requestingUserGithubUsername: "Alice" });
    const toolDef = createEnsurePRTool(ctx, deps);
    const result = await toolDef.handler(
      { title: "PR", summary: "S", reviewers: ["alice", "bob", "bob"] },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.warning, undefined);
    assert.equal(mockRequestReviewers.mock.calls.length, 1);
    const reqArgs = mockRequestReviewers.mock.calls[0]![0];
    assert.equal(reqArgs.pull_number, 42);
    assert.deepEqual(reqArgs.reviewers, ["bob"]);
  });

  it("requests reviewers on an existing PR when the flag is on", async () => {
    const mockList = vi.fn(async () => ({
      data: [{ number: 55, html_url: "https://github.com/org/my-repo/pull/55" }],
    }));
    const mockRequestReviewers = vi.fn<
      (args: { pull_number: number; reviewers: string[] }) => Promise<object>
    >(async () => ({}));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: {
        list: mockList,
        create: vi.fn(),
        update: vi.fn(),
        requestReviewers: mockRequestReviewers,
      },
    }));

    const ctx = makeCtx({ requirePRReviewers: true, requestingUserGithubUsername: "alice" });
    const toolDef = createEnsurePRTool(ctx, deps);
    const result = await toolDef.handler(
      { title: "PR", summary: "S", reviewers: ["alice", "bob"] },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.created, false);
    assert.equal(mockRequestReviewers.mock.calls.length, 1);
    const reqArgs = mockRequestReviewers.mock.calls[0]![0];
    assert.equal(reqArgs.pull_number, 55);
    assert.deepEqual(reqArgs.reviewers, ["bob"]);
  });

  it("keeps success with a warning when requestReviewers fails", async () => {
    const mockList = vi.fn(async () => ({ data: [] }));
    const mockCreate = vi.fn(async () => ({
      data: { number: 7, html_url: "https://github.com/org/my-repo/pull/7" },
    }));
    const mockRequestReviewers = vi.fn(async () => {
      throw new Error("422 not a collaborator");
    });
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate, requestReviewers: mockRequestReviewers },
    }));

    const ctx = makeCtx({ requirePRReviewers: true, requestingUserGithubUsername: null });
    const toolDef = createEnsurePRTool(ctx, deps);
    const result = await toolDef.handler(
      { title: "PR", summary: "S", reviewers: ["bob"] },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.pr_url, "https://github.com/org/my-repo/pull/7");
    assert.ok(parsed.warning);
  });

  it("warns (no request) when the flag is on but no reviewer resolves", async () => {
    const mockList = vi.fn(async () => ({ data: [] }));
    const mockCreate = vi.fn(async () => ({
      data: { number: 8, html_url: "https://github.com/org/my-repo/pull/8" },
    }));
    const mockRequestReviewers = vi.fn(async () => ({}));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate, requestReviewers: mockRequestReviewers },
    }));

    const ctx = makeCtx({ requirePRReviewers: true, requestingUserGithubUsername: null });
    const toolDef = createEnsurePRTool(ctx, deps);
    const result = await toolDef.handler(
      { title: "PR", summary: "S", reviewers: [] },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.ok(parsed.warning);
    assert.equal(mockRequestReviewers.mock.calls.length, 0);
  });

  it("ignores reviewers entirely when the flag is off (no request, no warning)", async () => {
    const mockList = vi.fn(async () => ({ data: [] }));
    const mockCreate = vi.fn(async () => ({
      data: { number: 9, html_url: "https://github.com/org/my-repo/pull/9" },
    }));
    const mockRequestReviewers = vi.fn(async () => ({}));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList, create: mockCreate, requestReviewers: mockRequestReviewers },
    }));

    const ctx = makeCtx({ requirePRReviewers: false });
    const toolDef = createEnsurePRTool(ctx, deps);
    const result = await toolDef.handler(
      { title: "PR", summary: "S", reviewers: ["alice", "bob"] },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.warning, undefined);
    assert.equal(mockRequestReviewers.mock.calls.length, 0);
  });

  it("calls list with correct owner:branch head filter", async () => {
    const mockList = vi.fn(async () => ({
      data: [{ html_url: "https://github.com/org/my-repo/pull/1" }],
    }));
    const { deps, mockGetOctokit } = makeDeps();
    mockGetOctokit.mockImplementation(async () => ({
      pulls: { list: mockList },
    }));

    const ctx = makeCtx();
    const toolDef = createEnsurePRTool(ctx, deps);
    await toolDef.handler(
      { title: "PR", summary: "S", reviewers: undefined },
      { sessionId: "test" },
    );

    const listArgs = mockList.mock.calls[0]! as never as [{ head: string; state: string }];
    assert.equal(listArgs[0].head, `org:${ctx.branchName}`);
    assert.equal(listArgs[0].state, "open");
  });
});
