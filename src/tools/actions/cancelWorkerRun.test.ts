import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createCancelWorkerRunTool, type CancelWorkerRunDeps } from "./cancelWorkerRun.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";
import type { ActiveChangeState } from "../../changes/activeState.js";
import type { ClaudeRunHandle } from "../../claude/runHandle.js";
import { makeFakeRunHandle as makeFakeHandle } from "../../claude/runHandle.testFixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeChange(partial: {
  repo: string;
  branch: string;
  status: string;
  handle?: ClaudeRunHandle;
  cancelledBy?: { userId: string; reason?: string };
}): ActiveChangeState {
  const change: ActiveChangeState = {
    description: "test",
    startedAt: new Date(),
    lastActivityAt: new Date(),
    ...partial,
  } as ActiveChangeState;
  return change;
}

function makeDeps(overrides?: Partial<CancelWorkerRunDeps>): CancelWorkerRunDeps {
  return {
    getActiveChangeForUser: mock.fn(() => undefined),
    canEditConfig: (role) => role === "admin" || role === "owner",
    cancelQueuedSession: () => false,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<QueryToolContext>): QueryToolContext {
  return {
    mode: "query",
    userId: "U_CALLER",
    role: "dev",
    session: {
      sessionId: "test-session",
      channelId: "C_DEFAULT",
      threadTs: "1234567890.000001",
    } as QueryToolContext["session"],
    config: {} as QueryToolContext["config"],
    changesWorkflowEnabled: true,
    allowScheduledMessages: false,
    ...overrides,
  };
}

describe("createCancelWorkerRunTool", () => {
  let deps: CancelWorkerRunDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("creates a tool named cancel_worker_run", () => {
    const tool = createCancelWorkerRunTool(makeContext(), deps);
    assert.equal(tool.name, "cancel_worker_run");
  });

  it("returns error when no active worker run exists", async () => {
    deps = makeDeps({
      getActiveChangeForUser: mock.fn(() => undefined),
    });

    const tool = createCancelWorkerRunTool(makeContext(), deps);
    const result = await tool.handler({ target_user_id: undefined, reason: undefined }, {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("No active worker run found"));
    assert.equal(result.isError, true);
  });

  it("stops a live worker run via the handle", async () => {
    const handle = makeFakeHandle();
    const change = fakeChange({
      repo: "my-repo",
      branch: "feat/my-change",
      status: "executing",
      handle,
      cancelledBy: undefined,
    });
    deps = makeDeps({
      getActiveChangeForUser: mock.fn(() => ({
        sessionId: "sess-123",
        change,
      })),
    });

    const tool = createCancelWorkerRunTool(makeContext(), deps);
    const result = await tool.handler({ target_user_id: undefined, reason: "taking too long" }, {});
    const parsed = parseToolResult(result);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.cancelled, true);
    assert.equal(parsed.sessionId, "sess-123");
    assert.ok(parsed.description.includes("my-repo"));
    assert.deepEqual(handle.stopCalls, ["taking too long"]);
    // cancelledBy should be set before stop
    assert.deepEqual(change.cancelledBy, { userId: "U_CALLER", reason: "taking too long" });
  });

  it("handles stale session without a handle", async () => {
    deps = makeDeps({
      getActiveChangeForUser: mock.fn(() => ({
        sessionId: "sess-456",
        change: fakeChange({
          repo: "my-repo",
          branch: "feat/stale",
          status: "executing",
          handle: undefined,
        }),
      })),
    });

    const tool = createCancelWorkerRunTool(makeContext(), deps);
    const result = await tool.handler({ target_user_id: undefined, reason: undefined }, {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("restart"));
    assert.equal(result.isError, true);
  });

  it("cancels a queued session when there's no live handle (reusable mode)", async () => {
    const cancelCalls: Array<{ sessionId: string; reason?: string }> = [];
    deps = makeDeps({
      getActiveChangeForUser: mock.fn(() => ({
        sessionId: "sess-queued",
        change: fakeChange({
          repo: "my-repo",
          branch: "feat/queued",
          status: "executing",
          handle: undefined,
        }),
      })),
      cancelQueuedSession: (sessionId, reason) => {
        cancelCalls.push({ sessionId, reason });
        return true; // queued entry found and cancelled
      },
    });

    const tool = createCancelWorkerRunTool(makeContext(), deps);
    const result = await tool.handler(
      { target_user_id: undefined, reason: "user changed mind" },
      {},
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.cancelled, true);
    assert.equal(parsed.queuedAtCancel, true);
    assert.equal(parsed.sessionId, "sess-queued");
    assert.match(parsed.message, /Queued request cancelled/);
    assert.deepEqual(cancelCalls, [{ sessionId: "sess-queued", reason: "user changed mind" }]);
  });

  it("falls through to stale-session error when neither handle nor queue entry exists", async () => {
    deps = makeDeps({
      getActiveChangeForUser: mock.fn(() => ({
        sessionId: "sess-ghost",
        change: fakeChange({
          repo: "my-repo",
          branch: "feat/ghost",
          status: "executing",
          handle: undefined,
        }),
      })),
      cancelQueuedSession: () => false, // no queued entry either
    });

    const tool = createCancelWorkerRunTool(makeContext(), deps);
    const result = await tool.handler({ target_user_id: undefined, reason: undefined }, {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("restart"));
    assert.equal(result.isError, true);
  });

  it("admin can cancel another user's run", async () => {
    const handle = makeFakeHandle();
    const change = fakeChange({
      repo: "my-repo",
      branch: "feat/other-user",
      status: "executing",
      handle,
      cancelledBy: undefined,
    });
    deps = makeDeps({
      getActiveChangeForUser: mock.fn(() => ({
        sessionId: "sess-789",
        change,
      })),
    });

    const tool = createCancelWorkerRunTool(makeContext({ role: "admin" }), deps);
    const result = await tool.handler({ target_user_id: "U_OTHER", reason: undefined }, {});
    const parsed = parseToolResult(result);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.cancelled, true);
    assert.deepEqual(handle.stopCalls, [undefined]);
    // cancelledBy records the admin, not the target
    assert.equal(change.cancelledBy!.userId, "U_CALLER");
  });

  it("non-admin cannot cancel another user's run", async () => {
    const tool = createCancelWorkerRunTool(makeContext({ role: "dev" }), deps);
    const result = await tool.handler({ target_user_id: "U_OTHER", reason: undefined }, {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Only admins"));
    assert.equal(result.isError, true);
  });

  it("works for reviewing status", async () => {
    const handle = makeFakeHandle();
    deps = makeDeps({
      getActiveChangeForUser: mock.fn(() => ({
        sessionId: "sess-review",
        change: fakeChange({
          repo: "my-repo",
          branch: "feat/review",
          status: "reviewing",
          handle,
        }),
      })),
    });

    const tool = createCancelWorkerRunTool(makeContext(), deps);
    const result = await tool.handler({ target_user_id: undefined, reason: undefined }, {});
    const parsed = parseToolResult(result);

    assert.equal(parsed.ok, true);
    assert.ok(parsed.description.includes("reviewing"));
    assert.deepEqual(handle.stopCalls, [undefined]);
  });
});
