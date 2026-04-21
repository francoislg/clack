import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stopThread, type StopPipelineDeps } from "./stopPipeline.js";
import type { InFlightRequest } from "./inFlightRequests.js";
import type { ActiveChangeState } from "../changes/activeState.js";
import type { SessionContext } from "../sessions.js";
import type { ChangeStatus } from "../changes/types.js";

interface FakeSetup {
  inFlight: { key: string; request: InFlightRequest }[];
  session: Partial<SessionContext> | null;
  activeChange: Partial<ActiveChangeState> | null;
  deregistered: string[];
  disengagedSessionIds: string[];
}

function makeDeps(setup: FakeSetup): StopPipelineDeps {
  return {
    findInFlightByThread: () => setup.inFlight,
    deregisterInFlightRequest: (_channel, messageTs) => {
      setup.deregistered.push(messageTs);
    },
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

function makeRequest(overrides?: Partial<InFlightRequest>): InFlightRequest {
  return {
    abortController: new AbortController(),
    sessionId: "s-1",
    triggerType: "mentions",
    threadTs: "t-1",
    ...overrides,
  };
}

describe("stopThread", () => {
  it("aborts a single in-flight query and deregisters it", async () => {
    const req = makeRequest();
    const setup: FakeSetup = {
      inFlight: [{ key: "C1:msg-1", request: req }],
      session: null,
      activeChange: null,
      deregistered: [],
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.equal(result.queryAborted, 1);
    assert.equal(result.workerAborted, false);
    assert.equal(result.sessionDisengaged, false);
    assert.equal(req.abortController.signal.aborted, true);
    assert.deepEqual(setup.deregistered, ["msg-1"]);
  });

  it("aborts multiple in-flight queries in the same thread", async () => {
    const r1 = makeRequest({ sessionId: "a" });
    const r2 = makeRequest({ sessionId: "b" });
    const setup: FakeSetup = {
      inFlight: [
        { key: "C1:1.001", request: r1 },
        { key: "C1:2.002", request: r2 },
      ],
      session: null,
      activeChange: null,
      deregistered: [],
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.equal(result.queryAborted, 2);
    assert.equal(r1.abortController.signal.aborted, true);
    assert.equal(r2.abortController.signal.aborted, true);
    assert.deepEqual(setup.deregistered.sort(), ["1.001", "2.002"]);
  });

  it("skips already-aborted in-flight entries", async () => {
    const req = makeRequest();
    req.abortController.abort();
    const setup: FakeSetup = {
      inFlight: [{ key: "C1:msg-1", request: req }],
      session: null,
      activeChange: null,
      deregistered: [],
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.equal(result.queryAborted, 0);
    assert.deepEqual(setup.deregistered, ["msg-1"]);
  });

  it("aborts the worker and sets cancelledBy during executing state", async () => {
    const abortController = new AbortController();
    const setup: FakeSetup = {
      inFlight: [],
      session: { sessionId: "s-1", autoResponseActive: true },
      activeChange: {
        status: "executing" as ChangeStatus,
        abortController,
      },
      deregistered: [],
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
    assert.equal(abortController.signal.aborted, true);
    assert.deepEqual(setup.activeChange?.cancelledBy, {
      userId: "U-reactor",
      reason: "stopped via reaction",
    });
  });

  it("does not abort a worker in terminal state", async () => {
    const abortController = new AbortController();
    for (const status of ["completed", "failed", "cancelled"] as ChangeStatus[]) {
      const setup: FakeSetup = {
        inFlight: [],
        session: { sessionId: "s-1", autoResponseActive: true },
        activeChange: { status, abortController },
        deregistered: [],
        disengagedSessionIds: [],
      };
      const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
      assert.equal(result.workerAborted, false, `expected no worker abort for status ${status}`);
      assert.equal(abortController.signal.aborted, false);
    }
  });

  it("does not overwrite an existing cancelledBy", async () => {
    const abortController = new AbortController();
    const setup: FakeSetup = {
      inFlight: [],
      session: { sessionId: "s-1", autoResponseActive: true },
      activeChange: {
        status: "executing" as ChangeStatus,
        abortController,
        cancelledBy: { userId: "U-first", reason: "first" },
      },
      deregistered: [],
      disengagedSessionIds: [],
    };
    await stopThread("C1", "t-1", "U-second", "second", makeDeps(setup));
    assert.deepEqual(setup.activeChange?.cancelledBy, { userId: "U-first", reason: "first" });
  });

  it("disengages an active session", async () => {
    const setup: FakeSetup = {
      inFlight: [],
      session: { sessionId: "s-disengage", autoResponseActive: true },
      activeChange: null,
      deregistered: [],
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.equal(result.sessionDisengaged, true);
    assert.deepEqual(setup.disengagedSessionIds, ["s-disengage"]);
  });

  it("is idempotent on already-disengaged sessions", async () => {
    const setup: FakeSetup = {
      inFlight: [],
      session: { sessionId: "s-already", autoResponseActive: false },
      activeChange: null,
      deregistered: [],
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.equal(result.sessionDisengaged, false);
    assert.deepEqual(setup.disengagedSessionIds, []);
  });

  it("no-ops when there is no session and no in-flight work", async () => {
    const setup: FakeSetup = {
      inFlight: [],
      session: null,
      activeChange: null,
      deregistered: [],
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U1", "test", makeDeps(setup));
    assert.deepEqual(result, { queryAborted: 0, workerAborted: false, sessionDisengaged: false });
  });

  it("combines query abort, worker abort, and disengage in a single call", async () => {
    const queryAbort = new AbortController();
    const workerAbort = new AbortController();
    const setup: FakeSetup = {
      inFlight: [
        {
          key: "C1:msg-1",
          request: makeRequest({ abortController: queryAbort }),
        },
      ],
      session: { sessionId: "s-combo", autoResponseActive: true },
      activeChange: { status: "executing" as ChangeStatus, abortController: workerAbort },
      deregistered: [],
      disengagedSessionIds: [],
    };
    const result = await stopThread("C1", "t-1", "U-reactor", "combo test", makeDeps(setup));
    assert.equal(result.queryAborted, 1);
    assert.equal(result.workerAborted, true);
    assert.equal(result.sessionDisengaged, true);
    assert.equal(queryAbort.signal.aborted, true);
    assert.equal(workerAbort.signal.aborted, true);
    assert.deepEqual(setup.disengagedSessionIds, ["s-combo"]);
  });
});
