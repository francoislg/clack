import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getSessionInfo,
  setSessionInfo,
  deleteSessionInfo,
  restoreSessionInfo,
} from "./state.js";
import type { SessionInfo } from "./state.js";

const sampleInfo: SessionInfo = {
  channelId: "C001",
  threadTs: "1700000000.000001",
  userId: "U001",
};

const dmInfo: SessionInfo = {
  channelId: "C002",
  threadTs: "1700000000.000002",
  userId: "U002",
  triggerType: "reactions",
  dmChannel: "D100",
  dmThreadTs: "1700000000.000100",
  originChannel: "C002",
  originThreadTs: "1700000000.000002",
  channelPostTs: "1700000000.000200",
};

// Clean up between tests to avoid cross-contamination
beforeEach(() => {
  // Delete any sessions we may have set in prior tests
  deleteSessionInfo("test-session-1");
  deleteSessionInfo("test-session-2");
  deleteSessionInfo("test-dm-session");
  deleteSessionInfo("restore-mem-session");
});

describe("setSessionInfo / getSessionInfo", () => {
  it("stores and retrieves session info by id", () => {
    setSessionInfo("test-session-1", sampleInfo);
    const result = getSessionInfo("test-session-1");
    assert.deepEqual(result, sampleInfo);
  });

  it("returns undefined for unknown session id", () => {
    const result = getSessionInfo("nonexistent-session");
    assert.equal(result, undefined);
  });

  it("preserves all DM-first fields", () => {
    setSessionInfo("test-dm-session", dmInfo);
    const result = getSessionInfo("test-dm-session");
    assert.deepEqual(result, dmInfo);
    assert.equal(result?.triggerType, "reactions");
    assert.equal(result?.dmChannel, "D100");
    assert.equal(result?.dmThreadTs, "1700000000.000100");
    assert.equal(result?.originChannel, "C002");
    assert.equal(result?.originThreadTs, "1700000000.000002");
    assert.equal(result?.channelPostTs, "1700000000.000200");
  });

  it("overwrites previous info for the same session id", () => {
    setSessionInfo("test-session-1", sampleInfo);
    const updated: SessionInfo = { ...sampleInfo, userId: "U999" };
    setSessionInfo("test-session-1", updated);

    const result = getSessionInfo("test-session-1");
    assert.equal(result?.userId, "U999");
  });
});

describe("deleteSessionInfo", () => {
  it("removes a previously stored session", () => {
    setSessionInfo("test-session-2", sampleInfo);
    assert.ok(getSessionInfo("test-session-2"));

    deleteSessionInfo("test-session-2");
    assert.equal(getSessionInfo("test-session-2"), undefined);
  });

  it("is a no-op for unknown session id", () => {
    // Should not throw
    deleteSessionInfo("never-existed");
  });
});

describe("restoreSessionInfo", () => {
  it("returns in-memory session without hitting disk", async () => {
    setSessionInfo("restore-mem-session", sampleInfo);
    const result = await restoreSessionInfo("restore-mem-session");
    assert.deepEqual(result, sampleInfo);
  });
});
