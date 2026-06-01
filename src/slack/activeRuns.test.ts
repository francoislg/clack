import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { ClaudeRunHandle } from "../claude/runHandle.js";
import {
  register,
  getByThread,
  getForChannelMessage,
  unregister,
  size,
  withThreadLock,
  _resetForTesting,
} from "./activeRuns.js";

/** A manually-resolvable promise, for ordering assertions without real timers. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Flush several microtask turns so chained `.then`s settle. */
async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

function fakeHandle(label: string): ClaudeRunHandle {
  return {
    sendUpdate: async () => {},
    stop: async () => {},
    futureResponse: Promise.resolve({ success: true, answer: label }),
    status: "running",
    hasPendingInput: () => false,
    consumePendingPushedTexts: () => [],
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

describe("withThreadLock", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("does not start a second section on the same key until the first releases", async () => {
    const order: string[] = [];
    let release1!: () => void;
    const body1Gate = deferred();
    const firstRunning = deferred();

    const p1 = withThreadLock("C1", "T1", async (release) => {
      order.push("1-start");
      release1 = release; // capture; release manually below (do NOT auto-release yet)
      firstRunning.resolve();
      await body1Gate.promise; // keep the first section's body alive past release
      order.push("1-end");
      return "1";
    });

    await firstRunning.promise;

    let secondStarted = false;
    const p2 = withThreadLock("C1", "T1", async () => {
      secondStarted = true;
      order.push("2-start");
      return "2";
    });

    // First has not released its slot yet → second must NOT have started.
    await flush();
    assert.equal(secondStarted, false);

    // Releasing opens the gate even though the first body is still running.
    release1();
    await flush();
    assert.equal(secondStarted, true);

    body1Gate.resolve();
    assert.deepEqual(await Promise.all([p1, p2]), ["1", "2"]);
    assert.deepEqual(order, ["1-start", "2-start", "1-end"]);
  });

  it("runs sections on different keys concurrently", async () => {
    const t1Running = deferred();
    const hold = deferred();
    let t2Started = false;

    const p1 = withThreadLock("C1", "T1", async () => {
      t1Running.resolve();
      await hold.promise; // never release until the end
      return "1";
    });
    await t1Running.promise;

    const p2 = withThreadLock("C1", "T2", async () => {
      t2Started = true;
      return "2";
    });

    await flush();
    // Different key → not blocked by T1 still holding its lock.
    assert.equal(t2Started, true);
    assert.equal(await p2, "2");

    hold.resolve();
    assert.equal(await p1, "1");
  });

  it("propagates the section's return value at completion", async () => {
    assert.equal(
      await withThreadLock("C1", "T1", async (release) => {
        release();
        return 42;
      }),
      42,
    );
  });

  it("a throwing section opens the gate (no deadlock) and the next section still runs", async () => {
    const p1 = withThreadLock("C1", "T1", async () => {
      throw new Error("boom");
    });
    await assert.rejects(p1, /boom/);

    // The chain must have advanced — a subsequent section on the same key runs to completion.
    const result = await withThreadLock("C1", "T1", async (release) => {
      release();
      return "after-throw";
    });
    assert.equal(result, "after-throw");
  });

  it("a section that never calls release still releases on completion (safety net)", async () => {
    let secondRan = false;
    // First section never calls `release` explicitly; the `finally` must open the gate.
    await withThreadLock("C1", "T1", async () => "1");
    await withThreadLock("C1", "T1", async () => {
      secondRan = true;
      return "2";
    });
    assert.equal(secondRan, true);
  });
});
