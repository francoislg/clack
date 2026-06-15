import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  createFindPullRequestsTool,
  type FindPullRequestsDeps,
  type ListPullsParams,
} from "./findPullRequests.js";
import type { QueryToolContext } from "../types.js";
import type { RepositoryConfig } from "../../config.js";
import { parseToolResult } from "../testHelpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      trigger: { type: "mentions", userId: "U123", messageTs: "1.0", messageText: "test" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: {
      repositories: [makeRepo()],
    } as QueryToolContext["config"],
    changesWorkflowEnabled: true,
    cronUserSchedules: false,
    ...overrides,
  };
}

interface FakePR {
  html_url: string;
  number: number;
  title: string;
  head: { ref: string };
  state: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  body: string | null;
}

function makePR(overrides?: Partial<FakePR>): FakePR {
  return {
    html_url: "https://github.com/org/my-repo/pull/1",
    number: 1,
    title: "Fix login",
    head: { ref: "fix/login" },
    state: "open",
    user: { login: "dev1" },
    created_at: "2025-06-01T08:00:00Z",
    updated_at: "2025-06-01T10:00:00Z",
    merged_at: null,
    body: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<FindPullRequestsDeps> = {}): FindPullRequestsDeps {
  return {
    getVisibleRepos: vi.fn(() => [makeRepo()]) as FindPullRequestsDeps["getVisibleRepos"],
    parseRepoUrl: vi.fn(() => ({
      owner: "org",
      repo: "my-repo",
    })) as FindPullRequestsDeps["parseRepoUrl"],
    listPulls: vi.fn(async () => ({ data: [] })) as FindPullRequestsDeps["listPulls"],
    ...overrides,
  };
}

type FindPRInput = Parameters<ReturnType<typeof createFindPullRequestsTool>["handler"]>[0];

function prInput(overrides: Partial<FindPRInput> = {}): FindPRInput {
  return {
    repo: "my-repo",
    state: "open",
    branch: undefined,
    since: undefined,
    offset: undefined,
    limit: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

type ListPullsFn = FindPullRequestsDeps["listPulls"];

function returning(data: FakePR[]): ListPullsFn {
  return vi.fn<ListPullsFn>(async () => ({ data }));
}

function throwing(message: string): ListPullsFn {
  return vi.fn<ListPullsFn>(async () => {
    throw new Error(message);
  });
}

describe("findPullRequests tool", () => {
  it("returns error when repo is not found or not accessible", async () => {
    const deps = makeDeps();

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ repo: "nonexistent" }), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("nonexistent"));
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("my-repo")); // lists available repos
    assert.equal(result.isError, true);
  });

  it("returns all open PRs when no branch filter is set", async () => {
    const pr1 = makePR({
      html_url: "https://github.com/org/my-repo/pull/1",
      title: "PR 1",
      head: { ref: "feat/a" },
    });
    const pr2 = makePR({
      html_url: "https://github.com/org/my-repo/pull/2",
      title: "PR 2",
      head: { ref: "fix/b" },
    });

    const deps = makeDeps({ listPulls: returning([pr1, pr2]) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.total, 2);
    assert.equal(parsed.pullRequests.length, 2);
    assert.equal(parsed.pullRequests[0].url, "https://github.com/org/my-repo/pull/1");
    assert.equal(parsed.pullRequests[0].title, "PR 1");
    assert.equal(parsed.pullRequests[0].branch, "feat/a");
    assert.equal(parsed.pullRequests[0].state, "open");
    assert.equal(parsed.pullRequests[1].branch, "fix/b");
  });

  it("filters PRs by branch name (partial match)", async () => {
    const pr1 = makePR({ title: "Feature A", head: { ref: "feat/login-page" } });
    const pr2 = makePR({ title: "Feature B", head: { ref: "feat/signup-page" } });
    const pr3 = makePR({ title: "Fix C", head: { ref: "fix/login-bug" } });

    const deps = makeDeps({ listPulls: returning([pr1, pr2, pr3]) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ branch: "login" }), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.total, 2);
    assert.equal(parsed.pullRequests.length, 2);
    assert.ok(parsed.pullRequests.every((pr: { branch: string }) => pr.branch.includes("login")));
  });

  it("returns empty list when no PRs exist", async () => {
    const deps = makeDeps({ listPulls: returning([]) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed.pullRequests, []);
    assert.equal(parsed.total, 0);
  });

  it("returns empty list when branch filter matches no PRs", async () => {
    const pr = makePR({ head: { ref: "feat/dashboard" } });

    const deps = makeDeps({ listPulls: returning([pr]) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ branch: "nonexistent" }), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed.pullRequests, []);
    assert.equal(parsed.total, 0);
  });

  it("returns error when listPulls throws", async () => {
    const deps = makeDeps({ listPulls: throwing("GitHub API rate limit exceeded") });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to fetch pull requests"));
    assert.ok(parsed.error.includes("rate limit"));
    assert.equal(result.isError, true);
  });

  it("returns error when listPulls throws Not found", async () => {
    const deps = makeDeps({ listPulls: throwing("Not found") });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Not found"));
    assert.equal(result.isError, true);
  });

  it("calls listPulls with correct owner and repo from parseRepoUrl", async () => {
    const listPullsMock = vi.fn<(params: ListPullsParams) => Promise<{ data: FakePR[] }>>(
      async () => ({ data: [] }),
    );
    const deps = makeDeps({
      parseRepoUrl: vi.fn<FindPullRequestsDeps["parseRepoUrl"]>(() => ({
        owner: "my-org",
        repo: "cool-project",
      })),
      listPulls: listPullsMock as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    await toolDef.handler(prInput(), { sessionId: "test" });

    assert.equal(listPullsMock.mock.calls.length, 1);
    const callArgs = listPullsMock.mock.calls[0]![0]!;
    assert.equal(callArgs.owner, "my-org");
    assert.equal(callArgs.repo, "cool-project");
    assert.equal(callArgs.state, "open");
    assert.equal(callArgs.sort, "updated");
    assert.equal(callArgs.direction, "desc");
    assert.equal(callArgs.per_page, 100);
  });

  it("maps lean PR fields and omits body from the result", async () => {
    const pr = makePR({
      html_url: "https://github.com/org/my-repo/pull/42",
      number: 42,
      title: "Add dark mode",
      head: { ref: "feat/dark-mode" },
      state: "open",
      user: { login: "alice" },
      created_at: "2025-12-25T08:00:00Z",
      updated_at: "2025-12-25T12:00:00Z",
      body: "Implements dark mode theme",
    });

    const deps = makeDeps({ listPulls: returning([pr]) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.pullRequests.length, 1);
    const pr0 = parsed.pullRequests[0];
    assert.equal(pr0.url, "https://github.com/org/my-repo/pull/42");
    assert.equal(pr0.number, 42);
    assert.equal(pr0.title, "Add dark mode");
    assert.equal(pr0.branch, "feat/dark-mode");
    assert.equal(pr0.state, "open");
    assert.equal(pr0.author, "alice");
    assert.equal(pr0.createdAt, "2025-12-25T08:00:00Z");
    assert.equal(pr0.updatedAt, "2025-12-25T12:00:00Z");
    assert.equal(pr0.mergedAt, undefined); // not merged
    assert.equal(pr0.body, undefined); // body is never included
    assert.ok(!("body" in pr0));
  });

  it("paginates with offset/limit and reports the filtered total", async () => {
    const prs = Array.from({ length: 5 }, (_, i) =>
      makePR({ number: i + 1, title: `PR ${i + 1}`, head: { ref: `feat/${i + 1}` } }),
    );

    const deps = makeDeps({ listPulls: returning(prs) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ offset: 1, limit: 2 }), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.total, 5);
    assert.equal(parsed.offset, 1);
    assert.equal(parsed.limit, 2);
    assert.equal(parsed.pullRequests.length, 2);
    assert.equal(parsed.pullRequests[0].number, 2);
    assert.equal(parsed.pullRequests[1].number, 3);
  });

  it("defaults to offset 0 and the default page limit", async () => {
    const prs = Array.from({ length: 25 }, (_, i) => makePR({ number: i + 1 }));

    const deps = makeDeps({ listPulls: returning(prs) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput(), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.total, 25);
    assert.equal(parsed.offset, 0);
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.pullRequests.length, 20);
  });

  it("returns an empty page when offset is beyond the total", async () => {
    const prs = Array.from({ length: 5 }, (_, i) => makePR({ number: i + 1 }));

    const deps = makeDeps({ listPulls: returning(prs) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ offset: 10, limit: 20 }), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed.pullRequests, []);
    assert.equal(parsed.total, 5);
    assert.equal(parsed.offset, 10);
  });

  it("surfaces fetchCapped only when the GitHub page is full", async () => {
    const ctx = makeCtx();

    const fullPage = Array.from({ length: 100 }, (_, i) => makePR({ number: i + 1 }));
    const cappedResult = await createFindPullRequestsTool(
      ctx,
      makeDeps({ listPulls: returning(fullPage) }),
    ).handler(prInput({ limit: 50 }), { sessionId: "test" });
    assert.equal(parseToolResult(cappedResult).fetchCapped, true);

    const partialPage = Array.from({ length: 3 }, (_, i) => makePR({ number: i + 1 }));
    const uncappedResult = await createFindPullRequestsTool(
      ctx,
      makeDeps({ listPulls: returning(partialPage) }),
    ).handler(prInput(), { sessionId: "test" });
    assert.equal(parseToolResult(uncappedResult).fetchCapped, undefined);
  });

  it("returns only merged PRs when state is 'merged'", async () => {
    const merged = makePR({
      number: 1,
      title: "Merged PR",
      state: "closed",
      merged_at: "2025-06-01T09:00:00Z",
    });
    const closedNotMerged = makePR({
      number: 2,
      title: "Closed PR",
      state: "closed",
      merged_at: null,
    });

    const listPullsMock = vi.fn<(params: ListPullsParams) => Promise<{ data: FakePR[] }>>(
      async () => ({ data: [merged, closedNotMerged] }),
    );
    const deps = makeDeps({ listPulls: listPullsMock as FindPullRequestsDeps["listPulls"] });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ state: "merged" }), { sessionId: "test" });

    // Should call API with state "closed" (merged is a subset of closed)
    const callArgs = listPullsMock.mock.calls[0]![0]!;
    assert.equal(callArgs.state, "closed");

    const parsed = parseToolResult(result);
    assert.equal(parsed.total, 1);
    assert.equal(parsed.pullRequests.length, 1);
    assert.equal(parsed.pullRequests[0].title, "Merged PR");
    assert.equal(parsed.pullRequests[0].state, "merged");
    assert.equal(parsed.pullRequests[0].mergedAt, "2025-06-01T09:00:00Z");
  });

  it("filters merged PRs by since date", async () => {
    const recentMerge = makePR({
      number: 1,
      title: "Recent",
      state: "closed",
      merged_at: "2025-06-02T10:00:00Z",
    });
    const oldMerge = makePR({
      number: 2,
      title: "Old",
      state: "closed",
      merged_at: "2025-05-01T10:00:00Z",
    });

    const deps = makeDeps({ listPulls: returning([recentMerge, oldMerge]) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ state: "merged", since: "2025-06-01" }), {
      sessionId: "test",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.pullRequests.length, 1);
    assert.equal(parsed.pullRequests[0].title, "Recent");
  });

  it("filters open PRs by since date using updated_at", async () => {
    const recent = makePR({ number: 1, title: "Recent", updated_at: "2025-06-02T10:00:00Z" });
    const old = makePR({ number: 2, title: "Old", updated_at: "2025-05-01T10:00:00Z" });

    const deps = makeDeps({ listPulls: returning([recent, old]) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ since: "2025-06-01" }), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.pullRequests.length, 1);
    assert.equal(parsed.pullRequests[0].title, "Recent");
  });

  it("shows 'merged' as state for merged PRs in any state filter", async () => {
    const mergedPR = makePR({ state: "closed", merged_at: "2025-06-01T09:00:00Z" });

    const deps = makeDeps({ listPulls: returning([mergedPR]) });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ state: "all" }), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.pullRequests[0].state, "merged");
  });

  it("lists available repos in the error message", async () => {
    const repoA = makeRepo({ name: "repo-a" });
    const repoB = makeRepo({ name: "repo-b" });
    const deps = makeDeps({
      getVisibleRepos: vi.fn<FindPullRequestsDeps["getVisibleRepos"]>(() => [repoA, repoB]),
    });

    const ctx = makeCtx({
      config: {
        repositories: [repoA, repoB],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(prInput({ repo: "unknown" }), { sessionId: "test" });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("repo-a"));
    assert.ok(parsed.error.includes("repo-b"));
  });
});
