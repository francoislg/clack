import { describe, it } from "node:test";
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
}

function makeDeps(setup: FakeSetup): StopPipelineDeps {
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
    assert.deepEqual(result, { queryAborted: 0, workerAborted: false, sessionDisengaged: false });
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
});
