import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { fetchPRReviewContext, getPRStatus, parsePrUrl, type PrDeps } from "./pr.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOctokit(
  overrides: {
    pulls?: {
      get?: (args: unknown) => Promise<unknown>;
      listReviewComments?: (args: unknown) => Promise<unknown>;
      listReviews?: (args: unknown) => Promise<unknown>;
    };
  } = {},
) {
  return {
    pulls: {
      get: overrides.pulls?.get ?? (async () => ({ data: {} })),
      listReviewComments: overrides.pulls?.listReviewComments ?? (async () => ({ data: [] })),
      listReviews: overrides.pulls?.listReviews ?? (async () => ({ data: [] })),
    },
  };
}

function makeDeps(overrides: Partial<PrDeps> = {}): PrDeps {
  return {
    getOctokit: vi.fn(async () => makeOctokit()) as never,
    ...overrides,
  };
}

// ============================================================================
// fetchPRReviewContext
// ============================================================================

describe("fetchPRReviewContext", () => {
  it("returns review context with reviews and comments", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            listReviews: async () => ({
              data: [
                {
                  user: { login: "reviewer1" },
                  state: "CHANGES_REQUESTED",
                  body: "Please fix the bug",
                },
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
      ) as never,
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/123", deps);
    assert.equal(result.ok, true);
    assert.ok("context" in result && result.context.includes("reviewer1"));
    assert.ok("context" in result && result.context.includes("CHANGES_REQUESTED"));
    assert.ok("context" in result && result.context.includes("Please fix the bug"));
    assert.ok("context" in result && result.context.includes("Looks good"));
    assert.ok("context" in result && result.context.includes("src/index.ts"));
    assert.ok("context" in result && result.context.includes("Typo here"));
  });

  it("returns 'no review comments' when there are none", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            listReviews: async () => ({ data: [] }),
            listReviewComments: async () => ({ data: [] }),
          },
        }),
      ) as never,
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1", deps);
    assert.equal(result.ok, true);
    assert.ok(
      "context" in result && result.context.includes("No review comments or feedback found"),
    );
  });

  it("skips reviews that have no body", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
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
      ) as never,
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/5", deps);
    assert.equal(result.ok, true);
    assert.ok("context" in result);
    assert.ok(!result.context.includes("bot"));
    assert.ok(result.context.includes("human"));
    assert.ok(result.context.includes("Ship it"));
  });

  it("handles missing user login gracefully", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
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
      ) as never,
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/7", deps);
    assert.equal(result.ok, true);
    assert.ok("context" in result && result.context.includes("unknown"));
  });

  it("handles missing line number in comments", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            listReviews: async () => ({ data: [] }),
            listReviewComments: async () => ({
              data: [
                {
                  user: { login: "reviewer" },
                  path: "src/app.ts",
                  line: null,
                  body: "General comment",
                },
              ],
            }),
          },
        }),
      ) as never,
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/10", deps);
    assert.equal(result.ok, true);
    assert.ok("context" in result && result.context.includes("src/app.ts:?"));
  });

  it("passes correct owner, repo, pull_number to GitHub API", async () => {
    let capturedReviewArgs: unknown;
    let capturedCommentArgs: unknown;

    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
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
      ) as never,
    });

    await fetchPRReviewContext("https://github.com/acme-corp/widget-api/pull/456", deps);

    assert.deepEqual(capturedReviewArgs, {
      owner: "acme-corp",
      repo: "widget-api",
      pull_number: 456,
    });
    assert.deepEqual(capturedCommentArgs, {
      owner: "acme-corp",
      repo: "widget-api",
      pull_number: 456,
    });
  });

  it("returns error for invalid PR URL", async () => {
    const deps = makeDeps();
    const result = await fetchPRReviewContext("https://example.com/not-a-pr", deps);
    assert.equal(result.ok, false);
    assert.ok("error" in result && result.error.includes("Invalid PR URL"));
  });

  it("returns error when GitHub API call fails", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            listReviews: async () => {
              throw new Error("API rate limit exceeded");
            },
            listReviewComments: async () => ({ data: [] }),
          },
        }),
      ) as never,
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1", deps);
    assert.equal(result.ok, false);
    assert.ok("error" in result && result.error.includes("API rate limit exceeded"));
  });

  it("returns error when getOctokit fails", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () => {
        throw new Error("GitHub credentials not loaded");
      }) as never,
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1", deps);
    assert.equal(result.ok, false);
    assert.ok("error" in result && result.error.includes("GitHub credentials not loaded"));
  });

  it("includes only reviews section when there are no inline comments", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            listReviews: async () => ({
              data: [{ user: { login: "reviewer" }, state: "APPROVED", body: "All good" }],
            }),
            listReviewComments: async () => ({ data: [] }),
          },
        }),
      ) as never,
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1", deps);
    assert.equal(result.ok, true);
    assert.ok("context" in result);
    assert.ok(result.context.includes("PR Reviews:"));
    assert.ok(!result.context.includes("Inline Comments:"));
  });

  it("includes only inline comments section when there are no reviews with body", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            listReviews: async () => ({ data: [] }),
            listReviewComments: async () => ({
              data: [{ user: { login: "reviewer" }, path: "src/foo.ts", line: 10, body: "Nit" }],
            }),
          },
        }),
      ) as never,
    });

    const result = await fetchPRReviewContext("https://github.com/myorg/myrepo/pull/1", deps);
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
  it("returns OPEN for an open PR", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            get: async () => ({ data: { state: "open", merged: false } }),
          },
        }),
      ) as never,
    });

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/1", deps);
    assert.deepEqual(result, { state: "OPEN" });
  });

  it("returns MERGED for a merged PR", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            get: async () => ({ data: { state: "closed", merged: true } }),
          },
        }),
      ) as never,
    });

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/2", deps);
    assert.deepEqual(result, { state: "MERGED" });
  });

  it("returns CLOSED for a closed (not merged) PR", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            get: async () => ({ data: { state: "closed", merged: false } }),
          },
        }),
      ) as never,
    });

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/3", deps);
    assert.deepEqual(result, { state: "CLOSED" });
  });

  it("prioritizes merged over closed state", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            get: async () => ({ data: { state: "closed", merged: true } }),
          },
        }),
      ) as never,
    });

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/4", deps);
    assert.deepEqual(result, { state: "MERGED" });
  });

  it("passes correct owner, repo, pull_number to GitHub API", async () => {
    let capturedArgs: unknown;
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            get: async (args: unknown) => {
              capturedArgs = args;
              return { data: { state: "open", merged: false } };
            },
          },
        }),
      ) as never,
    });

    await getPRStatus("https://github.com/acme/widgets/pull/789", deps);
    assert.deepEqual(capturedArgs, { owner: "acme", repo: "widgets", pull_number: 789 });
  });

  it("returns null when GitHub API call fails", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            get: async () => {
              throw new Error("Not Found");
            },
          },
        }),
      ) as never,
    });

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/999", deps);
    assert.equal(result, null);
  });

  it("returns null when getOctokit fails", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () => {
        throw new Error("No credentials");
      }) as never,
    });

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/1", deps);
    assert.equal(result, null);
  });

  it("returns null for an invalid PR URL", async () => {
    const deps = makeDeps();
    const result = await getPRStatus("not-a-url", deps);
    assert.equal(result, null);
  });

  it("handles PR URLs with extra path segments", async () => {
    const deps = makeDeps({
      getOctokit: vi.fn(async () =>
        makeOctokit({
          pulls: {
            get: async () => ({ data: { state: "open", merged: false } }),
          },
        }),
      ) as never,
    });

    const result = await getPRStatus("https://github.com/myorg/myrepo/pull/42/files", deps);
    assert.deepEqual(result, { state: "OPEN" });
  });
});
