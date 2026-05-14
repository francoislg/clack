import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { ClaudeRunHandle } from "../claude/runHandle.js";
import {
  register,
  getByThread,
  getForChannelMessage,
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

  it("does NOT collapse different DM threads under a per-user key", () => {
    // Critical: two assistant threads in the same DM channel for the same user must
    // remain isolated. A run in thread T1 must NOT be returned when looking up T2.
    const a = fakeHandle("a");
    const b = fakeHandle("b");
    register({ channelId: "D1", threadTs: "T1" }, a);
    register({ channelId: "D1", threadTs: "T2" }, b);
    assert.strictEqual(getByThread("D1", "T1"), a);
    assert.strictEqual(getByThread("D1", "T2"), b);
    // The combined-lookup helper must also respect the thread boundary in DMs.
    assert.strictEqual(getForChannelMessage("D1", "T1", "U1"), a);
    assert.strictEqual(getForChannelMessage("D1", "T2", "U1"), b);
    // A lookup for a brand-new thread in the same DM channel must NOT find the
    // handle from another thread.
    assert.equal(getForChannelMessage("D1", "T_NEW", "U1"), undefined);
  });
});
