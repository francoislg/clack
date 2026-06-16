import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createAwaitCiTool, type AwaitCiDeps } from "./awaitCi.js";
import { makeWorkerCtx } from "./testCtx.js";
import type { ActiveChangeState } from "../../changes/activeState.js";
import type { CIChecksSnapshot } from "../../changes/pr.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";

const PR_URL = "https://github.com/org/my-repo/pull/7";

function activeChange(prUrl?: string): ActiveChangeState {
  return {
    branch: "clack/fix/x",
    repo: "my-repo",
    description: "d",
    status: "pr_created",
    prUrl,
    startedAt: new Date(0),
    lastActivityAt: new Date(0),
  };
}

function makeDeps(opts: { prUrl?: string; snapshots?: (CIChecksSnapshot | null)[] }): {
  deps: AwaitCiDeps;
  clock: () => number;
} {
  let clock = 0;
  const queue = [...(opts.snapshots ?? [])];
  const deps: AwaitCiDeps = {
    getActiveChange: () => activeChange(opts.prUrl),
    getPRChecks: async () => (queue.length > 1 ? queue.shift()! : (queue[0] ?? null)),
    appendExecutionLog: vi.fn(),
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    capMs: 100,
    intervalMs: 50,
  };
  return { deps, clock: () => clock };
}

const snap = (
  status: CIChecksSnapshot["status"],
  extra: Partial<CIChecksSnapshot> = {},
): CIChecksSnapshot => ({ status, failedChecks: [], pendingChecks: [], ...extra });

describe("await_ci tool", () => {
  it("returns passed when all checks succeed", async () => {
    const { deps } = makeDeps({ prUrl: PR_URL, snapshots: [snap("all_passed")] });
    const result = await createAwaitCiTool(makeWorkerCtx(), deps).handler(
      { _placeholder: undefined },
      { sessionId: "t" },
    );
    assert.equal(parseToolResult(result).state, "passed");
  });

  it("returns failed with failedChecks and stops early", async () => {
    const failed = snap("some_failed", {
      failedChecks: [{ name: "lint", conclusion: "failure", detailsUrl: "u" }],
    });
    const { deps } = makeDeps({ prUrl: PR_URL, snapshots: [failed] });
    const result = await createAwaitCiTool(makeWorkerCtx(), deps).handler(
      { _placeholder: undefined },
      { sessionId: "t" },
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.state, "failed");
    assert.equal(parsed.failedChecks[0].name, "lint");
  });

  it("returns pending when no checks ever register, up to the cap", async () => {
    const { deps } = makeDeps({ prUrl: PR_URL, snapshots: [snap("no_checks")] });
    const result = await createAwaitCiTool(makeWorkerCtx(), deps).handler(
      { _placeholder: undefined },
      { sessionId: "t" },
    );
    assert.equal(parseToolResult(result).state, "pending");
  });

  it("returns timed_out with pendingChecks when checks never finish", async () => {
    const { deps } = makeDeps({
      prUrl: PR_URL,
      snapshots: [snap("in_progress", { pendingChecks: ["build"] })],
    });
    const result = await createAwaitCiTool(makeWorkerCtx(), deps).handler(
      { _placeholder: undefined },
      { sessionId: "t" },
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.state, "timed_out");
    assert.deepEqual(parsed.pendingChecks, ["build"]);
  });

  it("polls until checks resolve (in_progress then passed)", async () => {
    const { deps } = makeDeps({
      prUrl: PR_URL,
      snapshots: [snap("in_progress", { pendingChecks: ["build"] }), snap("all_passed")],
    });
    const result = await createAwaitCiTool(makeWorkerCtx(), deps).handler(
      { _placeholder: undefined },
      { sessionId: "t" },
    );
    assert.equal(parseToolResult(result).state, "passed");
  });

  it("returns a structured error (not a verdict) when CI cannot be read at all", async () => {
    const { deps } = makeDeps({ prUrl: PR_URL, snapshots: [null] });
    const result = await createAwaitCiTool(makeWorkerCtx(), deps).handler(
      { _placeholder: undefined },
      { sessionId: "t" },
    );
    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /could not read ci status/i);
  });

  it("errors when no PR exists yet", async () => {
    const { deps } = makeDeps({ prUrl: undefined, snapshots: [snap("all_passed")] });
    const result = await createAwaitCiTool(makeWorkerCtx(), deps).handler(
      { _placeholder: undefined },
      { sessionId: "t" },
    );
    assert.equal(result.isError, true);
    assert.match(toolResultText(result), /ensure_pr/i);
  });
});
