import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { stopThread, type StopPipelineDeps } from "./stopPipeline.js";
import type { ActiveChangeState } from "../changes/activeState.js";
import type { SessionContext } from "../sessions.js";
import type { ChangeStatus } from "../changes/types.js";
import { makeFakeRunHandle, type FakeRunHandle } from "../claude/runHandle.testFixtures.js";

interface FakeSetup {
  /** Handle returned by `getActiveRunByThread` for the (channel, thread) under test. */
  queryHandle: FakeRunHandle | null;
  session: Partial<SessionContext> | null;
  activeChange: Partial<ActiveChangeState> | null;
  disengagedSessionIds: string[];
  /** When set, simulates the session being in the reusable-pool queue. */
  queuedSessionId?: string;
  /** Records every (sessionId, reason) cancelQueuedSession was called with. */
  cancelQueuedCalls?: Array<{ sessionId: string; reason?: string }>;
}

function makeDeps(setup: FakeSetup): StopPipelineDeps {
  setup.cancelQueuedCalls = setup.cancelQueuedCalls ?? [];
  return {
    getActiveRunByThread: () => setup.queryHandle ?? undefined,
    findSessionByThread: async () => {
      if (!setup.session) return null;
      return setup.session as SessionContext;
    },
    getActiveChange: () => {
      if (!setup.activeChange) return undefined;
      return setup.activeChange as ActiveChangeState;
    },
    setAutoResponseActive: async (sessionId, _active) => {
      setup.disengagedSessionIds.push(sessionId);
    },
    cancelQueuedSession: (sessionId, reason) => {
      setup.cancelQueuedCalls!.push({ sessionId, reason });
      return setup.queuedSessionId === sessionId;
    },
  };
}

describe("stopThread", () => {
  it("stops the active query-side run when one is registered", async () => {
    const handle = makeFakeRunHandle();
    const setup: FakeSetup = {
      queryHandle: handle,
      session: null,
      activeChange: null,
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.equal(result.queryAborted, 1);
    assert.equal(result.workerAborted, false);
    assert.equal(result.sessionDisengaged, false);
    assert.deepEqual(handle.stopCalls, ["test"]);
    assert.equal(handle.status, "stopped");
  });

  it("skips an already-settled run handle", async () => {
    const handle = makeFakeRunHandle("settled");
    const setup: FakeSetup = {
      queryHandle: handle,
      session: null,
      activeChange: null,
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.equal(result.queryAborted, 0);
    assert.deepEqual(handle.stopCalls, []);
  });

  it("stops the worker run and sets cancelledBy during executing state", async () => {
    const workerHandle = makeFakeRunHandle();
    const setup: FakeSetup = {
      queryHandle: null,
      session: { sessionId: "s-1", autoResponseActive: true },
      activeChange: {
        status: "executing" as ChangeStatus,
        handle: workerHandle,
      },
      disengagedSessionIds: [],
    };
    const result = await stopThread(
      "C1",
      "t-1",
      "U-reactor",
      "stopped via reaction",
      makeDeps(setup),
    );
    assert.equal(result.workerAborted, true);
    assert.deepEqual(workerHandle.stopCalls, ["stopped via reaction"]);
    assert.deepEqual(setup.activeChange?.cancelledBy, {
      userId: "U-reactor",
      reason: "stopped via reaction",
    });
  });

  it("does not stop a worker in terminal state", async () => {
    for (const status of ["completed", "failed", "cancelled"] as ChangeStatus[]) {
      const workerHandle = makeFakeRunHandle();
      const setup: FakeSetup = {
        queryHandle: null,
        session: { sessionId: "s-1", autoResponseActive: true },
        activeChange: { status, handle: workerHandle },
        disengagedSessionIds: [],
      };
      const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
      assert.equal(result.workerAborted, false, `expected no worker stop for status ${status}`);
      assert.deepEqual(workerHandle.stopCalls, [], `expected no stop call for status ${status}`);
    }
  });

  it("does not overwrite an existing cancelledBy", async () => {
    const workerHandle = makeFakeRunHandle();
    const setup: FakeSetup = {
      queryHandle: null,
      session: { sessionId: "s-1", autoResponseActive: true },
      activeChange: {
        status: "executing" as ChangeStatus,
        handle: workerHandle,
        cancelledBy: { userId: "U-first", reason: "first" },
      },
      disengagedSessionIds: [],
    };
    await stopThread("C1", "t-1", "U-second", "second", makeDeps(setup));
    assert.deepEqual(setup.activeChange?.cancelledBy, { userId: "U-first", reason: "first" });
  });

  it("disengages an active session", async () => {
    const setup: FakeSetup = {
      queryHandle: null,
      session: { sessionId: "s-disengage", autoResponseActive: true },
      activeChange: null,
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.equal(result.sessionDisengaged, true);
    assert.deepEqual(setup.disengagedSessionIds, ["s-disengage"]);
  });

  it("is idempotent on already-disengaged sessions", async () => {
    const setup: FakeSetup = {
      queryHandle: null,
      session: { sessionId: "s-already", autoResponseActive: false },
      activeChange: null,
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.equal(result.sessionDisengaged, false);
    assert.deepEqual(setup.disengagedSessionIds, []);
  });

  it("no-ops when there is no session and no active run", async () => {
    const setup: FakeSetup = {
      queryHandle: null,
      session: null,
      activeChange: null,
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.deepEqual(result, {
      queryAborted: 0,
      workerAborted: false,
      queuedCancelled: false,
      sessionDisengaged: false,
    });
  });

  it("combines query stop, worker stop, and disengage in a single call", async () => {
    const queryHandle = makeFakeRunHandle();
    const workerHandle = makeFakeRunHandle();
    const setup: FakeSetup = {
      queryHandle,
      session: { sessionId: "s-combo", autoResponseActive: true },
      activeChange: { status: "executing" as ChangeStatus, handle: workerHandle },
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U-reactor", "combo test", makeDeps(setup));
    assert.equal(result.queryAborted, 1);
    assert.equal(result.workerAborted, true);
    assert.equal(result.sessionDisengaged, true);
    assert.deepEqual(queryHandle.stopCalls, ["combo test"]);
    assert.deepEqual(workerHandle.stopCalls, ["combo test"]);
    assert.deepEqual(setup.disengagedSessionIds, ["s-combo"]);
  });

  it("cancels a queued session when the active change has no live handle", async () => {
    const setup: FakeSetup = {
      queryHandle: null,
      session: { sessionId: "s-queued", autoResponseActive: true },
      // activeChange exists in a non-terminal status but has no handle — typical
      // shape for a session waiting on `pool.acquire` to dequeue.
      activeChange: { status: "executing" as ChangeStatus, handle: undefined },
      disengagedSessionIds: [],
      queuedSessionId: "s-queued",
    };
    const result = await stopThread("C1", "t-1", "U-reactor", "user stopped", makeDeps(setup));
    assert.equal(result.queuedCancelled, true);
    assert.equal(result.workerAborted, false);
    assert.equal(result.sessionDisengaged, true);
    assert.deepEqual(setup.cancelQueuedCalls, [{ sessionId: "s-queued", reason: "user stopped" }]);
    assert.deepEqual((setup.activeChange as ActiveChangeState).cancelledBy, {
      userId: "U-reactor",
      reason: "user stopped",
    });
  });

  it("does not flag queuedCancelled when the queue lookup misses", async () => {
    const setup: FakeSetup = {
      queryHandle: null,
      session: { sessionId: "s-ghost", autoResponseActive: true },
      activeChange: { status: "executing" as ChangeStatus, handle: undefined },
      disengagedSessionIds: [],
      // queuedSessionId omitted → cancelQueuedSession returns false
    };
    const result = await stopThread("C1", "t-1", "U-reactor", "miss", makeDeps(setup));
    assert.equal(result.queuedCancelled, false);
    assert.equal(result.workerAborted, false);
    // Session is still disengaged regardless of queue miss
    assert.equal(result.sessionDisengaged, true);
  });

  it("prefers stopping the live handle over checking the queue", async () => {
    const workerHandle = makeFakeRunHandle();
    const setup: FakeSetup = {
      queryHandle: null,
      session: { sessionId: "s-live", autoResponseActive: true },
      activeChange: { status: "executing" as ChangeStatus, handle: workerHandle },
      disengagedSessionIds: [],
      queuedSessionId: "s-live", // pretend it's queued too (impossible, but tests precedence)
    };
    const result = await stopThread("C1", "t-1", "U1", "live wins", makeDeps(setup));
    assert.equal(result.workerAborted, true);
    assert.equal(result.queuedCancelled, false);
    // cancelQueuedSession should not have been consulted when a handle was available
    assert.deepEqual(setup.cancelQueuedCalls, []);
  });
});
