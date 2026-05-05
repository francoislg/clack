import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { ClaudeRunHandle } from "../claude/runHandle.js";
import {
  register,
  getByThread,
  getByDm,
  unregister,
  size,
  _resetForTesting,
} from "./activeRuns.js";

function fakeHandle(label: string): ClaudeRunHandle {
  return {
    sendUpdate: async () => {},
    stop: async () => {},
    futureResponse: Promise.resolve({ success: true, answer: label }),
    status: "running",
    hasPendingInput: () => false,
  };
}

describe("activeRuns", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("registers and looks up a handle by thread key", () => {
    const h = fakeHandle("a");
    assert.equal(register({ channelId: "C1", threadTs: "T1" }, h), true);
    assert.strictEqual(getByThread("C1", "T1"), h);
  });

  it("rejects double registration for the same thread key", () => {
    const a = fakeHandle("a");
    const b = fakeHandle("b");
    assert.equal(register({ channelId: "C1", threadTs: "T1" }, a), true);
    assert.equal(register({ channelId: "C1", threadTs: "T1" }, b), false);
    assert.strictEqual(getByThread("C1", "T1"), a);
  });

  it("allows registering the same key after unregister", () => {
    const a = fakeHandle("a");
    const b = fakeHandle("b");
    register({ channelId: "C1", threadTs: "T1" }, a);
    unregister(a);
    assert.equal(register({ channelId: "C1", threadTs: "T1" }, b), true);
    assert.strictEqual(getByThread("C1", "T1"), b);
  });

  it("treats different threads as independent slots", () => {
    const a = fakeHandle("a");
    const b = fakeHandle("b");
    register({ channelId: "C1", threadTs: "T1" }, a);
    register({ channelId: "C1", threadTs: "T2" }, b);
    assert.strictEqual(getByThread("C1", "T1"), a);
    assert.strictEqual(getByThread("C1", "T2"), b);
    assert.equal(size(), 2);
  });

  it("treats the same thread in different channels as independent", () => {
    const a = fakeHandle("a");
    const b = fakeHandle("b");
    register({ channelId: "C1", threadTs: "T1" }, a);
    register({ channelId: "C2", threadTs: "T1" }, b);
    assert.strictEqual(getByThread("C1", "T1"), a);
    assert.strictEqual(getByThread("C2", "T1"), b);
  });

  it("supports the top-level invariant (messageTs == threadTs)", () => {
    const h = fakeHandle("top");
    register({ channelId: "C1", threadTs: "M1" }, h);
    assert.strictEqual(getByThread("C1", "M1"), h);
  });

  it("unregister is a no-op for handles that were never registered", () => {
    const a = fakeHandle("a");
    register({ channelId: "C1", threadTs: "T1" }, a);
    const b = fakeHandle("b");
    unregister(b); // never registered, should not affect a
    assert.strictEqual(getByThread("C1", "T1"), a);
    unregister(a);
    assert.equal(getByThread("C1", "T1"), undefined);
  });

  it("getByThread returns undefined for an empty slot", () => {
    assert.equal(getByThread("C1", "T1"), undefined);
  });

  it("registers under a DM key when dmUserId is supplied", () => {
    const h = fakeHandle("dm");
    register({ channelId: "D1", threadTs: "T1", dmUserId: "U1" }, h);
    assert.strictEqual(getByDm("D1", "U1"), h);
    // Also still findable by the thread key.
    assert.strictEqual(getByThread("D1", "T1"), h);
  });

  it("getByDm returns undefined for handles registered without dmUserId", () => {
    const h = fakeHandle("nodm");
    register({ channelId: "C1", threadTs: "T1" }, h);
    assert.equal(getByDm("C1", "U1"), undefined);
  });

  it("rejects registration when the DM key is occupied", () => {
    const a = fakeHandle("a");
    const b = fakeHandle("b");
    register({ channelId: "D1", threadTs: "T1", dmUserId: "U1" }, a);
    // Same DM, different threadTs (a follow-up DM) — should still be rejected because the
    // per-user DM slot is taken.
    assert.equal(register({ channelId: "D1", threadTs: "T2", dmUserId: "U1" }, b), false);
  });

  it("unregister cleans up both thread and DM keys for a single handle", () => {
    const h = fakeHandle("h");
    register({ channelId: "D1", threadTs: "T1", dmUserId: "U1" }, h);
    unregister(h);
    assert.equal(getByThread("D1", "T1"), undefined);
    assert.equal(getByDm("D1", "U1"), undefined);
  });
});
