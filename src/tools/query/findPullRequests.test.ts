import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createFindPullRequestsTool,
  type FindPullRequestsDeps,
  type ListPullsParams,
} from "./findPullRequests.js";
import type { QueryToolContext } from "../types.js";
import type { RepositoryConfig } from "../../config.js";

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
    allowScheduledMessages: false,
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

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function makeDeps(overrides: Partial<FindPullRequestsDeps> = {}): FindPullRequestsDeps {
  return {
    getVisibleRepos: mock.fn(() => [makeRepo()]) as FindPullRequestsDeps["getVisibleRepos"],
    parseRepoUrl: mock.fn(() => ({
      owner: "org",
      repo: "my-repo",
    })) as FindPullRequestsDeps["parseRepoUrl"],
    listPulls: mock.fn(async () => ({ data: [] })) as FindPullRequestsDeps["listPulls"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findPullRequests tool", () => {
  it("returns error when repo is not found or not accessible", async () => {
    const deps = makeDeps();

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "nonexistent", state: "open", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
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

    const deps = makeDeps({
      listPulls: mock.fn(async () => ({ data: [pr1, pr2] })) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "open", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

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

    const deps = makeDeps({
      listPulls: mock.fn(async () => ({
        data: [pr1, pr2, pr3],
      })) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "open", branch: "login", since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 2);
    assert.ok(parsed.every((pr: { branch: string }) => pr.branch.includes("login")));
  });

  it("returns empty array when no PRs exist", async () => {
    const deps = makeDeps({
      listPulls: mock.fn(async () => ({ data: [] })) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "open", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns empty array when branch filter matches no PRs", async () => {
    const pr = makePR({ head: { ref: "feat/dashboard" } });

    const deps = makeDeps({
      listPulls: mock.fn(async () => ({ data: [pr] })) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "open", branch: "nonexistent", since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns error when listPulls throws", async () => {
    const deps = makeDeps({
      listPulls: mock.fn(async () => {
        throw new Error("GitHub API rate limit exceeded");
      }) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "open", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Failed to fetch pull requests"));
    assert.ok(parsed.error.includes("rate limit"));
    assert.equal(result.isError, true);
  });

  it("returns error when listPulls throws Not found", async () => {
    const deps = makeDeps({
      listPulls: mock.fn(async () => {
        throw new Error("Not found");
      }) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "open", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Not found"));
    assert.equal(result.isError, true);
  });

  it("calls listPulls with correct owner and repo from parseRepoUrl", async () => {
    const listPullsMock = mock.fn<(params: ListPullsParams) => Promise<{ data: FakePR[] }>>(
      async () => ({ data: [] }),
    );
    const deps = makeDeps({
      parseRepoUrl: mock.fn(() => ({
        owner: "my-org",
        repo: "cool-project",
      })) as FindPullRequestsDeps["parseRepoUrl"],
      listPulls: listPullsMock as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    await toolDef.handler(
      { repo: "my-repo", state: "open", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    assert.equal(listPullsMock.mock.callCount(), 1);
    const callArgs = listPullsMock.mock.calls[0]!.arguments[0]!;
    assert.equal(callArgs.owner, "my-org");
    assert.equal(callArgs.repo, "cool-project");
    assert.equal(callArgs.state, "open");
    assert.equal(callArgs.sort, "updated");
    assert.equal(callArgs.direction, "desc");
    assert.equal(callArgs.per_page, 100);
  });

  it("maps PR fields correctly in the result", async () => {
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

    const deps = makeDeps({
      listPulls: mock.fn(async () => ({ data: [pr] })) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "open", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].url, "https://github.com/org/my-repo/pull/42");
    assert.equal(parsed[0].number, 42);
    assert.equal(parsed[0].title, "Add dark mode");
    assert.equal(parsed[0].branch, "feat/dark-mode");
    assert.equal(parsed[0].state, "open");
    assert.equal(parsed[0].author, "alice");
    assert.equal(parsed[0].createdAt, "2025-12-25T08:00:00Z");
    assert.equal(parsed[0].updatedAt, "2025-12-25T12:00:00Z");
    assert.equal(parsed[0].mergedAt, undefined); // not merged
    assert.equal(parsed[0].body, "Implements dark mode theme");
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

    const listPullsMock = mock.fn<(params: ListPullsParams) => Promise<{ data: FakePR[] }>>(
      async () => ({ data: [merged, closedNotMerged] }),
    );
    const deps = makeDeps({ listPulls: listPullsMock as FindPullRequestsDeps["listPulls"] });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "merged", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    // Should call API with state "closed" (merged is a subset of closed)
    const callArgs = listPullsMock.mock.calls[0]!.arguments[0]!;
    assert.equal(callArgs.state, "closed");

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].title, "Merged PR");
    assert.equal(parsed[0].state, "merged");
    assert.equal(parsed[0].mergedAt, "2025-06-01T09:00:00Z");
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

    const deps = makeDeps({
      listPulls: mock.fn(async () => ({
        data: [recentMerge, oldMerge],
      })) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "merged", branch: undefined, since: "2025-06-01" },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].title, "Recent");
  });

  it("filters open PRs by since date using updated_at", async () => {
    const recent = makePR({ number: 1, title: "Recent", updated_at: "2025-06-02T10:00:00Z" });
    const old = makePR({ number: 2, title: "Old", updated_at: "2025-05-01T10:00:00Z" });

    const deps = makeDeps({
      listPulls: mock.fn(async () => ({
        data: [recent, old],
      })) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "open", branch: undefined, since: "2025-06-01" },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].title, "Recent");
  });

  it("shows 'merged' as state for merged PRs in any state filter", async () => {
    const mergedPR = makePR({ state: "closed", merged_at: "2025-06-01T09:00:00Z" });

    const deps = makeDeps({
      listPulls: mock.fn(async () => ({ data: [mergedPR] })) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "all", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed[0].state, "merged");
  });

  it("includes body truncated to 500 chars", async () => {
    const longBody = "x".repeat(600);
    const pr = makePR({ body: longBody });

    const deps = makeDeps({
      listPulls: mock.fn(async () => ({ data: [pr] })) as FindPullRequestsDeps["listPulls"],
    });

    const ctx = makeCtx();
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "my-repo", state: "open", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed[0].body.length, 500);
  });

  it("lists available repos in the error message", async () => {
    const repoA = makeRepo({ name: "repo-a" });
    const repoB = makeRepo({ name: "repo-b" });
    const deps = makeDeps({
      getVisibleRepos: mock.fn(() => [repoA, repoB]) as FindPullRequestsDeps["getVisibleRepos"],
    });

    const ctx = makeCtx({
      config: {
        repositories: [repoA, repoB],
      } as QueryToolContext["config"],
    });
    const toolDef = createFindPullRequestsTool(ctx, deps);

    const result = await toolDef.handler(
      { repo: "unknown", state: "open", branch: undefined, since: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("repo-a"));
    assert.ok(parsed.error.includes("repo-b"));
  });
});
