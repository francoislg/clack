import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

mock.module("../logger.js", {
  namedExports: {
    logger: {
      debug: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
    },
  },
});

// Import after mocks
const {
  registerInFlightRequest,
  deregisterInFlightRequest,
  getInFlightRequest,
} = await import("./inFlightRequests.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides?: Partial<{
  abortController: AbortController;
  sessionId: string;
  triggerType: "directMessages" | "mentions";
}>) {
  return {
    abortController: new AbortController(),
    sessionId: "session-1",
    triggerType: "directMessages" as const,
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
