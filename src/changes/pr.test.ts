import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockGetOctokit = mock.fn<() => Promise<unknown>>();

mock.module("../github.js", {
  namedExports: {
    getOctokit: mockGetOctokit,
  },
});

mock.module("../logger.js", {
  namedExports: {
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  },
});

// Import after mocks are registered
const { fetchPRReviewContext, getPRStatus } = await import("./pr.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOctokit(overrides: {
  pulls?: {
    get?: (args: unknown) => Promise<unknown>;
    listReviewComments?: (args: unknown) => Promise<unknown>;
    listReviews?: (args: unknown) => Promise<unknown>;
  };
} = {}) {
  return {
    pulls: {
      get: overrides.pulls?.get ?? (async () => ({ data: {} })),
      listReviewComments: overrides.pulls?.listReviewComments ?? (async () => ({ data: [] })),
      listReviews: overrides.pulls?.listReviews ?? (async () => ({ data: [] })),
    },
  };
}

function resetMocks(): void {
  mockGetOctokit.mock.resetCalls();
  mockGetOctokit.mock.mockImplementation(async () => makeOctokit());
}

// ============================================================================
// fetchPRReviewContext
// ============================================================================

describe("fetchPRReviewContext", () => {
  beforeEach(resetMocks);

  it("returns review context with reviews and comments", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          listReviews: async () => ({
            data: [
              { user: { login: "reviewer1" }, state: "CHANGES_REQUESTED", body: "Please fix the bug" },
              { user: { login: "reviewer2" }, state: "APPROVED", body: "Looks good" },
            ],
          }),
          listReviewComments: async () => ({
            data: [
              { user: { login: "reviewer1" }, path: "src/index.ts", line: 42, body: "Typo here" },
            ],
          }),
        },
      }),
    );

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/123");
    assert.equal(result.ok, true);
    assert.ok("context" in result && result.context.includes("reviewer1"));
    assert.ok("context" in result && result.context.includes("CHANGES_REQUESTED"));
    assert.ok("context" in result && result.context.includes("Please fix the bug"));
    assert.ok("context" in result && result.context.includes("Looks good"));
    assert.ok("context" in result && result.context.includes("src/index.ts"));
    assert.ok("context" in result && result.context.includes("Typo here"));
  });

  it("returns 'no review comments' when there are none", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
        },
      }),
    );

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1");
    assert.equal(result.ok, true);
    assert.ok("context" in result && result.context.includes("No review comments or feedback found"));
  });

  it("skips reviews that have no body", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          listReviews: async () => ({
            data: [
              { user: { login: "bot" }, state: "COMMENTED", body: "" },
              { user: { login: "human" }, state: "APPROVED", body: "Ship it" },
            ],
          }),
          listReviewComments: async () => ({ data: [] }),
        },
      }),
    );

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/5");
    assert.equal(result.ok, true);
    assert.ok("context" in result);
    // Empty body review should be skipped
    assert.ok(!result.context.includes("bot"));
    assert.ok(result.context.includes("human"));
    assert.ok(result.context.includes("Ship it"));
  });

  it("handles missing user login gracefully", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          listReviews: async () => ({
            data: [{ user: null, state: "APPROVED", body: "LGTM" }],
          }),
          listReviewComments: async () => ({
            data: [{ user: null, path: "README.md", line: 1, body: "Fix this" }],
          }),
        },
      }),
    );

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/7");
    assert.equal(result.ok, true);
    assert.ok("context" in result && result.context.includes("unknown"));
  });

  it("handles missing line number in comments", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({
            data: [
              { user: { login: "reviewer" }, path: "src/app.ts", line: null, body: "General comment" },
            ],
          }),
        },
      }),
    );

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/10");
    assert.equal(result.ok, true);
    assert.ok("context" in result && result.context.includes("src/app.ts:?"));
  });

  it("passes correct owner, repo, pull_number to GitHub API", async () => {
    let capturedReviewArgs: unknown;
    let capturedCommentArgs: unknown;

    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          listReviews: async (args: unknown) => {
            capturedReviewArgs = args;
            return { data: [] };
          },
          listReviewComments: async (args: unknown) => {
            capturedCommentArgs = args;
            return { data: [] };
          },
        },
      }),
    );

    await fetchPRReviewContext("https://github.com/acme-corp/widget-api/pull/456");

    assert.deepEqual(capturedReviewArgs, { owner: "acme-corp", repo: "widget-api", pull_number: 456 });
    assert.deepEqual(capturedCommentArgs, { owner: "acme-corp", repo: "widget-api", pull_number: 456 });
  });

  it("returns error for invalid PR URL", async () => {
    const result = await fetchPRReviewContext("https://example.com/not-a-pr");
    assert.equal(result.ok, false);
    assert.ok("error" in result && result.error.includes("Invalid PR URL"));
  });

  it("returns error when GitHub API call fails", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          listReviews: async () => {
            throw new Error("API rate limit exceeded");
          },
          listReviewComments: async () => ({ data: [] }),
        },
      }),
    );

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1");
    assert.equal(result.ok, false);
    assert.ok("error" in result && result.error.includes("API rate limit exceeded"));
  });

  it("returns error when getOctokit fails", async () => {
    mockGetOctokit.mock.mockImplementation(async () => {
      throw new Error("GitHub credentials not loaded");
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1");
    assert.equal(result.ok, false);
    assert.ok("error" in result && result.error.includes("GitHub credentials not loaded"));
  });

  it("includes only reviews section when there are no inline comments", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          listReviews: async () => ({
            data: [{ user: { login: "reviewer" }, state: "APPROVED", body: "All good" }],
          }),
          listReviewComments: async () => ({ data: [] }),
        },
      }),
    );

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1");
    assert.equal(result.ok, true);
    assert.ok("context" in result);
    assert.ok(result.context.includes("PR Reviews:"));
    assert.ok(!result.context.includes("Inline Comments:"));
  });

  it("includes only inline comments section when there are no reviews with body", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({
            data: [{ user: { login: "reviewer" }, path: "src/foo.ts", line: 10, body: "Nit" }],
          }),
        },
      }),
    );

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1");
    assert.equal(result.ok, true);
    assert.ok("context" in result);
    assert.ok(!result.context.includes("PR Reviews:"));
    assert.ok(result.context.includes("Inline Comments:"));
  });
});

// ============================================================================
// getPRStatus
// ============================================================================

describe("getPRStatus", () => {
  beforeEach(resetMocks);

  it("returns OPEN for an open PR", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          get: async () => ({ data: { state: "open", merged: false } }),
        },
      }),
    );

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/1");
    assert.deepEqual(result, { state: "OPEN" });
  });

  it("returns MERGED for a merged PR", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          get: async () => ({ data: { state: "closed", merged: true } }),
        },
      }),
    );

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/2");
    assert.deepEqual(result, { state: "MERGED" });
  });

  it("returns CLOSED for a closed (not merged) PR", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          get: async () => ({ data: { state: "closed", merged: false } }),
        },
      }),
    );

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/3");
    assert.deepEqual(result, { state: "CLOSED" });
  });

  it("prioritizes merged over closed state", async () => {
    // A merged PR also has state "closed" — the merged flag takes priority
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          get: async () => ({ data: { state: "closed", merged: true } }),
        },
      }),
    );

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/4");
    assert.deepEqual(result, { state: "MERGED" });
  });

  it("passes correct owner, repo, pull_number to GitHub API", async () => {
    let capturedArgs: unknown;
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          get: async (args: unknown) => {
            capturedArgs = args;
            return { data: { state: "open", merged: false } };
          },
        },
      }),
    );

    await getPRStatus("https://github.com/acme/widgets/pull/789");
    assert.deepEqual(capturedArgs, { owner: "acme", repo: "widgets", pull_number: 789 });
  });

  it("returns null when GitHub API call fails", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          get: async () => {
            throw new Error("Not Found");
          },
        },
      }),
    );

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/999");
    assert.equal(result, null);
  });

  it("returns null when getOctokit fails", async () => {
    mockGetOctokit.mock.mockImplementation(async () => {
      throw new Error("No credentials");
    });

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/1");
    assert.equal(result, null);
  });

  it("returns null for an invalid PR URL", async () => {
    const result = await getPRStatus("not-a-url");
    assert.equal(result, null);
  });

  it("handles PR URLs with extra path segments", async () => {
    mockGetOctokit.mock.mockImplementation(async () =>
      makeOctokit({
        pulls: {
          get: async () => ({ data: { state: "open", merged: false } }),
        },
      }),
    );

    // The regex should still match the PR number from the URL
    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/42/files");
    assert.deepEqual(result, { state: "OPEN" });
  });
});
