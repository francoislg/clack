import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createGitPushTool, type GitPushDeps } from "./gitPush.js";
import { makeWorkerConfig, makeWorkerCtx } from "./testCtx.js";
import { findRepoByName } from "../../config.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(opts: { pushImpl?: (args: string[]) => Promise<void> } = {}) {
  const mockRemote = vi.fn<(args: string[]) => Promise<void>>(async () => undefined);
  const mockFetch = vi.fn<(args: string[]) => Promise<void>>(async () => undefined);
  const mockPush = vi.fn<(args: string[]) => Promise<void>>(
    opts.pushImpl ?? (async () => undefined),
  );
  const mockRevparse = vi.fn<(args: string[]) => Promise<string>>(async () => "abc123\n");
  const mockGetAuthenticatedCloneUrl = vi.fn<GitPushDeps["getAuthenticatedCloneUrl"]>(
    async () => "https://x-access-token:tok@github.com/org/my-repo.git",
  );
  const mockAppendExecutionLog = vi.fn<GitPushDeps["appendExecutionLog"]>();
  const mockSimpleGit = vi.fn<GitPushDeps["simpleGit"]>(() => ({
    remote: mockRemote,
    fetch: mockFetch,
    push: mockPush,
    revparse: mockRevparse,
  }));

  const deps: GitPushDeps = {
    getAuthenticatedCloneUrl: mockGetAuthenticatedCloneUrl,
    appendExecutionLog: mockAppendExecutionLog,
    findRepoByName,
    simpleGit: mockSimpleGit,
  };

  return { deps, mockAppendExecutionLog, mockRemote, mockFetch, mockPush, mockRevparse };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gitPush tool", () => {
  it("pushes the branch with a same-name refspec and returns success", async () => {
    const { deps, mockRemote, mockPush, mockFetch } = makeDeps();
    const ctx = makeWorkerCtx();
    const result = await createGitPushTool(ctx, deps).handler(
      { force: undefined },
      { sessionId: "t" },
    );

    assert.equal(parseToolResult(result).success, true);
    assert.equal(result.isError, undefined);

    assert.deepEqual(mockRemote.mock.calls[0]![0], [
      "set-url",
      "origin",
      "https://x-access-token:tok@github.com/org/my-repo.git",
    ]);
    assert.deepEqual(mockPush.mock.calls[0]![0], ["-u", "origin", ctx.branchName]);
    assert.equal(mockFetch.mock.calls.length, 0);
  });

  it("force-pushes with an explicit lease on the fetched tip, never bare --force", async () => {
    const { deps, mockFetch, mockPush, mockRevparse } = makeDeps();
    const ctx = makeWorkerCtx();
    const result = await createGitPushTool(ctx, deps).handler({ force: true }, { sessionId: "t" });

    assert.equal(parseToolResult(result).success, true);
    assert.deepEqual(mockFetch.mock.calls[0]![0], ["origin", ctx.branchName]);
    assert.deepEqual(mockRevparse.mock.calls[0]![0], ["FETCH_HEAD"]);
    const pushArgs = mockPush.mock.calls[0]![0] as string[];
    assert.deepEqual(pushArgs, [
      "origin",
      ctx.branchName,
      `--force-with-lease=${ctx.branchName}:abc123`,
    ]);
    assert.ok(!pushArgs.includes("--force"));
  });

  it("leases against branch absence when the remote branch does not exist", async () => {
    const { deps, mockFetch, mockPush } = makeDeps();
    mockFetch.mockRejectedValueOnce(new Error("couldn't find remote ref"));
    const ctx = makeWorkerCtx();
    const result = await createGitPushTool(ctx, deps).handler({ force: true }, { sessionId: "t" });

    assert.equal(parseToolResult(result).success, true);
    assert.equal(mockPush.mock.calls.length, 1);
    const pushArgs = mockPush.mock.calls[0]![0] as string[];
    assert.ok(pushArgs.includes(`--force-with-lease=${ctx.branchName}:`));
  });

  it("returns a structured error without pushing when the lease fetch fails", async () => {
    const { deps, mockFetch, mockPush } = makeDeps();
    mockFetch.mockRejectedValueOnce(new Error("could not resolve host: github.com"));
    const ctx = makeWorkerCtx();
    const result = await createGitPushTool(ctx, deps).handler({ force: true }, { sessionId: "t" });

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /could not fetch origin\//);
    assert.equal(mockPush.mock.calls.length, 0);
  });

  it("refuses to push to a hardcoded protected branch (master) without pushing", async () => {
    const { deps, mockPush } = makeDeps();
    const ctx = makeWorkerCtx({ branchName: "master" });
    const result = await createGitPushTool(ctx, deps).handler(
      { force: undefined },
      { sessionId: "t" },
    );

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /protected branch/i);
    assert.equal(mockPush.mock.calls.length, 0);
  });

  it("refuses to push to the repository's configured default branch", async () => {
    const { deps, mockPush } = makeDeps();
    const ctx = makeWorkerCtx({
      branchName: "develop",
      config: makeWorkerConfig([
        {
          name: "my-repo",
          url: "https://github.com/org/my-repo.git",
          description: "",
          branch: "develop",
        },
      ]),
    });
    const result = await createGitPushTool(ctx, deps).handler(
      { force: undefined },
      { sessionId: "t" },
    );

    assert.equal(result.isError, true);
    assert.equal(mockPush.mock.calls.length, 0);
  });

  it("returns a structured error (never throws) when the push is rejected", async () => {
    const { deps } = makeDeps({
      pushImpl: async () => {
        throw new Error("! [rejected] (non-fast-forward)");
      },
    });
    const ctx = makeWorkerCtx();
    const result = await createGitPushTool(ctx, deps).handler(
      { force: undefined },
      { sessionId: "t" },
    );

    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /non-fast-forward/);
  });

  it("does not escalate to a bare --force when force-with-lease is rejected", async () => {
    const { deps, mockPush } = makeDeps({
      pushImpl: async () => {
        throw new Error("stale info");
      },
    });
    const ctx = makeWorkerCtx();
    const result = await createGitPushTool(ctx, deps).handler({ force: true }, { sessionId: "t" });

    assert.equal(result.isError, true);
    assert.equal(mockPush.mock.calls.length, 1);
    const pushArgs = mockPush.mock.calls[0]![0] as string[];
    assert.ok(pushArgs.some((arg) => arg.startsWith("--force-with-lease=")));
    assert.ok(!pushArgs.includes("--force"));
  });
});
