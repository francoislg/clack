import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetVisibleRepos = mock.fn<(...args: unknown[]) => unknown[]>();

mock.module("../../repoAccess.js", {
  namedExports: {
    getVisibleRepos: mockGetVisibleRepos,
  },
});

const mockParseRepoUrl = mock.fn<(url: string) => { owner: string; repo: string }>();
const mockGetOctokit = mock.fn<() => Promise<unknown>>();

mock.module("../../github.js", {
  namedExports: {
    parseRepoUrl: mockParseRepoUrl,
    getOctokit: mockGetOctokit,
  },
});

mock.module("../../logger.js", {
  namedExports: {
    logger: {
      debug: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
    },
  },
});

mock.module("../../errors.js", {
  namedExports: {
    errorMessage: (err: unknown) =>
      err instanceof Error ? err.message : String(err),
  },
});

// Import after mocks
const { createFindPullRequestsTool } = await import("./findPullRequests.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";
import type { RepositoryConfig } from "../../config.js";

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
      originalQuestion: "test",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: {
      repositories: [makeRepo()],
    } as QueryToolContext["config"],
    changesWorkflowEnabled: true,
    allowScheduledMessages: false,
    ...overrides,
  };
}

function makePR(overrides?: Record<string, unknown>) {
  return {
    html_url: "https://github.com/org/my-repo/pull/1",
    title: "Fix login",
    head: { ref: "fix/login" },
    state: "open",
    updated_at: "2025-06-01T10:00:00Z",
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockGetVisibleRepos.mock.resetCalls();
  mockParseRepoUrl.mock.resetCalls();
  mockGetOctokit.mock.resetCalls();

  mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo()]);
  mockParseRepoUrl.mock.mockImplementation(() => ({ owner: "org", repo: "my-repo" }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findPullRequests tool", () => {
  beforeEach(resetMocks);

  it("returns error when repo is not found or not accessible", async () => {
    mockGetVisibleRepos.mock.mockImplementation(() => [makeRepo()]);

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx);

    const result = await toolDef.handler({ repo: "nonexistent", branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("nonexistent"));
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("my-repo")); // lists available repos
    assert.equal(result.isError, true);
  });

  it("returns all open PRs when no branch filter is set", async () => {
    const pr1 = makePR({ html_url: "https://github.com/org/my-repo/pull/1", title: "PR 1", head: { ref: "feat/a" } });
    const pr2 = makePR({ html_url: "https://github.com/org/my-repo/pull/2", title: "PR 2", head: { ref: "fix/b" } });

    const mockOctokit = {
      pulls: {
        list: mock.fn(async () => ({ data: [pr1, pr2] })),
      },
    };
    mockGetOctokit.mock.mockImplementation(async () => mockOctokit);

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].url, "https://github.com/org/my-repo/pull/1");
    assert.equal(parsed[0].title, "PR 1");
    assert.equal(parsed[0].branch, "feat/a");
    assert.equal(parsed[0].state, "open");
    assert.equal(parsed[1].branch, "fix/b");
  });

  it("filters PRs by branch name (partial match)", async () => {
    const pr1 = makePR({ title: "Feature A", head: { ref: "feat/login-page" } });
    const pr2 = makePR({ title: "Feature B", head: { ref: "feat/signup-page" } });
    const pr3 = makePR({ title: "Fix C", head: { ref: "fix/login-bug" } });

    const mockOctokit = {
      pulls: {
        list: mock.fn(async () => ({ data: [pr1, pr2, pr3] })),
      },
    };
    mockGetOctokit.mock.mockImplementation(async () => mockOctokit);

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", branch: "login" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 2);
    assert.ok(parsed.every((pr: { branch: string }) => pr.branch.includes("login")));
  });

  it("returns empty array when no PRs exist", async () => {
    const mockOctokit = {
      pulls: {
        list: mock.fn(async () => ({ data: [] })),
      },
    };
    mockGetOctokit.mock.mockImplementation(async () => mockOctokit);

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns empty array when branch filter matches no PRs", async () => {
    const pr = makePR({ head: { ref: "feat/dashboard" } });

    const mockOctokit = {
      pulls: {
        list: mock.fn(async () => ({ data: [pr] })),
      },
    };
    mockGetOctokit.mock.mockImplementation(async () => mockOctokit);

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", branch: "nonexistent" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns error when GitHub API call fails", async () => {
    mockGetOctokit.mock.mockImplementation(async () => {
      throw new Error("GitHub API rate limit exceeded");
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to fetch pull requests"));
    assert.ok(parsed.error.includes("rate limit"));
    assert.equal(result.isError, true);
  });

  it("returns error when octokit.pulls.list throws", async () => {
    const mockOctokit = {
      pulls: {
        list: mock.fn(async () => {
          throw new Error("Not found");
        }),
      },
    };
    mockGetOctokit.mock.mockImplementation(async () => mockOctokit);

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Not found"));
    assert.equal(result.isError, true);
  });

  it("calls octokit with correct owner and repo from parseRepoUrl", async () => {
    mockParseRepoUrl.mock.mockImplementation(() => ({ owner: "my-org", repo: "cool-project" }));

    const listFn = mock.fn(async () => ({ data: [] }));
    const mockOctokit = { pulls: { list: listFn } };
    mockGetOctokit.mock.mockImplementation(async () => mockOctokit);

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx);

    await toolDef.handler({ repo: "my-repo", branch: undefined }, { sessionId: "test" });

    assert.equal(listFn.mock.callCount(), 1);
    const callArgs = (listFn.mock.calls[0].arguments as unknown as [{ owner: string; repo: string; state: string; per_page: number }])[0];
    assert.equal(callArgs.owner, "my-org");
    assert.equal(callArgs.repo, "cool-project");
    assert.equal(callArgs.state, "open");
    assert.equal(callArgs.per_page, 100);
  });

  it("maps PR fields correctly in the result", async () => {
    const pr = makePR({
      html_url: "https://github.com/org/my-repo/pull/42",
      title: "Add dark mode",
      head: { ref: "feat/dark-mode" },
      state: "open",
      updated_at: "2025-12-25T12:00:00Z",
    });

    const mockOctokit = {
      pulls: {
        list: mock.fn(async () => ({ data: [pr] })),
      },
    };
    mockGetOctokit.mock.mockImplementation(async () => mockOctokit);

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx);

    const result = await toolDef.handler({ repo: "my-repo", branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].url, "https://github.com/org/my-repo/pull/42");
    assert.equal(parsed[0].title, "Add dark mode");
    assert.equal(parsed[0].branch, "feat/dark-mode");
    assert.equal(parsed[0].state, "open");
    assert.equal(parsed[0].updatedAt, "2025-12-25T12:00:00Z");
  });

  it("lists available repos in the error message", async () => {
    const repoA = makeRepo({ name: "repo-a" });
    const repoB = makeRepo({ name: "repo-b" });
    mockGetVisibleRepos.mock.mockImplementation(() => [repoA, repoB]);

    const ctx = makeCtx({
      config: {
        repositories: [repoA, repoB],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindPullRequestsTool(ctx);

    const result = await toolDef.handler({ repo: "unknown", branch: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("repo-a"));
    assert.ok(parsed.error.includes("repo-b"));
  });
});
