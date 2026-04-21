import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  registerInFlightRequest,
  deregisterInFlightRequest,
  getInFlightRequest,
  findInFlightByThread,
  type InFlightRequest,
} from "./inFlightRequests.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  overrides?: Partial<{
    abortController: AbortController;
    sessionId: string;
    triggerType: InFlightRequest["triggerType"];
    threadTs: string;
  }>,
): InFlightRequest {
  return {
    abortController: new AbortController(),
    sessionId: "session-1",
    triggerType: "directMessages",
    threadTs: "thread-default",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("inFlightRequests", () => {
  // Deregister any leftovers between tests by using unique channel/ts combos

  describe("registerInFlightRequest", () => {
    it("stores a request that can be retrieved", () => {
      const req = makeRequest({ sessionId: "reg-1" });
      registerInFlightRequest("C001", "1000.001", req);

      const result = getInFlightRequest("C001", "1000.001");
      assert.equal(result, req);

      // cleanup
      deregisterInFlightRequest("C001", "1000.001");
    });

    it("overwrites a previous request for the same key", () => {
      const req1 = makeRequest({ sessionId: "overwrite-1" });
      const req2 = makeRequest({ sessionId: "overwrite-2" });

      registerInFlightRequest("C002", "2000.001", req1);
      registerInFlightRequest("C002", "2000.001", req2);

      const result = getInFlightRequest("C002", "2000.001");
      assert.equal(result?.sessionId, "overwrite-2");

      deregisterInFlightRequest("C002", "2000.001");
    });
  });

  describe("getInFlightRequest", () => {
    it("returns undefined for an unregistered key", () => {
      const result = getInFlightRequest("CXXX", "9999.999");
      assert.equal(result, undefined);
    });

    it("distinguishes between different channel/ts combinations", () => {
      const req1 = makeRequest({ sessionId: "diff-1" });
      const req2 = makeRequest({ sessionId: "diff-2" });

      registerInFlightRequest("C100", "100.001", req1);
      registerInFlightRequest("C200", "100.001", req2);

      assert.equal(getInFlightRequest("C100", "100.001")?.sessionId, "diff-1");
      assert.equal(getInFlightRequest("C200", "100.001")?.sessionId, "diff-2");

      deregisterInFlightRequest("C100", "100.001");
      deregisterInFlightRequest("C200", "100.001");
    });
  });

  describe("findInFlightByThread", () => {
    it("returns a reactions-triggered entry by thread", () => {
      const req = makeRequest({
        sessionId: "reaction-1",
        triggerType: "reactions",
        threadTs: "thread-react",
      });
      registerInFlightRequest("C010", "react.001", req);

      const matches = findInFlightByThread("C010", "thread-react");
      assert.equal(matches.length, 1);
      assert.equal(matches[0]?.request.sessionId, "reaction-1");

      deregisterInFlightRequest("C010", "react.001");
    });

    it("returns multiple entries sharing the same thread", () => {
      const a = makeRequest({ sessionId: "a", triggerType: "mentions", threadTs: "t-multi" });
      const b = makeRequest({
        sessionId: "b",
        triggerType: "directMessages",
        threadTs: "t-multi",
      });
      registerInFlightRequest("C020", "1.001", a);
      registerInFlightRequest("C020", "2.002", b);

      const matches = findInFlightByThread("C020", "t-multi");
      const ids = matches.map((m) => m.request.sessionId).sort();
      assert.deepEqual(ids, ["a", "b"]);

      deregisterInFlightRequest("C020", "1.001");
      deregisterInFlightRequest("C020", "2.002");
    });

    it("ignores entries in different threads or channels", () => {
      const a = makeRequest({ sessionId: "same-channel", threadTs: "t-A" });
      const b = makeRequest({ sessionId: "other-thread", threadTs: "t-B" });
      const c = makeRequest({ sessionId: "other-channel", threadTs: "t-A" });
      registerInFlightRequest("C030", "1.001", a);
      registerInFlightRequest("C030", "2.002", b);
      registerInFlightRequest("C031", "3.003", c);

      const matches = findInFlightByThread("C030", "t-A");
      const ids = matches.map((m) => m.request.sessionId);
      assert.deepEqual(ids, ["same-channel"]);

      deregisterInFlightRequest("C030", "1.001");
      deregisterInFlightRequest("C030", "2.002");
      deregisterInFlightRequest("C031", "3.003");
    });

    it("returns an empty array when no entries match", () => {
      const matches = findInFlightByThread("C-NONE", "thread-missing");
      assert.deepEqual(matches, []);
    });
  });

  describe("deregisterInFlightRequest", () => {
    it("removes a previously registered request", () => {
      const req = makeRequest({ sessionId: "dereg-1" });
      registerInFlightRequest("C003", "3000.001", req);

      deregisterInFlightRequest("C003", "3000.001");

      const result = getInFlightRequest("C003", "3000.001");
      assert.equal(result, undefined);
    });

    it("does nothing when called with an unregistered key", () => {
      // Should not throw
      deregisterInFlightRequest("CNONE", "0000.000");
    });

    it("does not affect other registered requests", () => {
      const req1 = makeRequest({ sessionId: "keep-1" });
      const req2 = makeRequest({ sessionId: "keep-2" });

      registerInFlightRequest("C004", "4000.001", req1);
      registerInFlightRequest("C005", "5000.001", req2);

      deregisterInFlightRequest("C004", "4000.001");

      assert.equal(getInFlightRequest("C004", "4000.001"), undefined);
      assert.equal(getInFlightRequest("C005", "5000.001")?.sessionId, "keep-2");

      deregisterInFlightRequest("C005", "5000.001");
    });
  });
});
