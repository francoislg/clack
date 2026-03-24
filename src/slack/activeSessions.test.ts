import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { activeSessions, type SessionInfo } from "./activeSessions.js";

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
  activeSessions.clear();
});

describe("activeSessions.set / activeSessions.get", () => {
  it("stores and retrieves session info by id", () => {
    activeSessions.set("test-session-1", sampleInfo);
    const result = activeSessions.get("test-session-1");
    assert.deepEqual(result, sampleInfo);
  });

  it("returns undefined for unknown session id", () => {
    const result = activeSessions.get("nonexistent-session");
    assert.equal(result, undefined);
  });

  it("preserves all DM-first fields", () => {
    activeSessions.set("test-dm-session", dmInfo);
    const result = activeSessions.get("test-dm-session");
    assert.deepEqual(result, dmInfo);
    assert.equal(result?.triggerType, "reactions");
    assert.equal(result?.dmChannel, "D100");
    assert.equal(result?.dmThreadTs, "1700000000.000100");
    assert.equal(result?.originChannel, "C002");
    assert.equal(result?.originThreadTs, "1700000000.000002");
    assert.equal(result?.channelPostTs, "1700000000.000200");
  });

  it("overwrites previous info for the same session id", () => {
    activeSessions.set("test-session-1", sampleInfo);
    const updated: SessionInfo = { ...sampleInfo, userId: "U999" };
    activeSessions.set("test-session-1", updated);

    const result = activeSessions.get("test-session-1");
    assert.equal(result?.userId, "U999");
  });
});

describe("activeSessions.delete", () => {
  it("removes a previously stored session", () => {
    activeSessions.set("test-session-2", sampleInfo);
    assert.ok(activeSessions.get("test-session-2"));

    activeSessions.delete("test-session-2");
    assert.equal(activeSessions.get("test-session-2"), undefined);
  });

  it("is a no-op for unknown session id", () => {
    // Should not throw
    activeSessions.delete("never-existed");
  });
});

describe("activeSessions.restore", () => {
  it("returns in-memory session without hitting disk", async () => {
    activeSessions.set("restore-mem-session", sampleInfo);
    const result = await activeSessions.restore("restore-mem-session");
    assert.deepEqual(result, sampleInfo);
  });
});
