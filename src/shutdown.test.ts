import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  drainAndExit,
  isQuiescing,
  resolveGraceMs,
  _resetForTesting,
  type DrainDeps,
} from "./shutdown.js";
import type { ClaudeRunHandle } from "./claude/runHandle.js";
import type { ClaudeResponse } from "./claude/index.js";

/** A controllable fake run handle. `settle()` resolves its `futureResponse`. */
function makeHandle(): {
  handle: ClaudeRunHandle;
  settle: () => void;
  stop: ReturnType<typeof vi.fn>;
} {
  let resolve!: (v: ClaudeResponse) => void;
  const futureResponse = new Promise<ClaudeResponse>((r) => {
    resolve = r;
  });
  const stop = vi.fn(async () => {
    resolve({ success: false, cancelled: true, answer: "" });
  });
  const handle: ClaudeRunHandle = {
    futureResponse,
    stop,
    status: "running",
    sendUpdate: vi.fn(async () => {}),
    hasPendingInput: () => false,
    consumePendingPushedTexts: () => [],
    hasDelivered: () => false,
  };
  return { handle, settle: () => resolve({ success: true, answer: "" }), stop };
}

function baseDeps(overrides: Partial<DrainDeps> = {}): DrainDeps {
  return {
    queryHandles: () => [],
    workerHandles: () => [],
    isBusy: () => false,
    teardown: vi.fn(async () => {}),
    exit: vi.fn(),
    graceMs: 1000,
    now: () => 0,
    delay: () => Promise.resolve(),
    ...overrides,
  };
}

describe("resolveGraceMs", () => {
  it("defaults to 300s when unset, invalid, or non-positive", () => {
    expect(resolveGraceMs({})).toBe(300_000);
    expect(resolveGraceMs({ SHUTDOWN_GRACE_SECONDS: "abc" })).toBe(300_000);
    expect(resolveGraceMs({ SHUTDOWN_GRACE_SECONDS: "0" })).toBe(300_000);
    expect(resolveGraceMs({ SHUTDOWN_GRACE_SECONDS: "-5" })).toBe(300_000);
  });

  it("uses a valid positive value", () => {
    expect(resolveGraceMs({ SHUTDOWN_GRACE_SECONDS: "60" })).toBe(60_000);
  });
});

describe("drainAndExit", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("exits immediately with code 0 when nothing is in flight", async () => {
    const deps = baseDeps({ isBusy: () => false });
    await drainAndExit(deps);
    expect(deps.teardown).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(isQuiescing()).toBe(true);
  });

  it("drains and exits 0 when the last run settles before the budget", async () => {
    const live = new Set<ClaudeRunHandle>();
    const { handle, settle, stop } = makeHandle();
    live.add(handle);
    const deps = baseDeps({
      isBusy: () => live.size > 0,
      queryHandles: () => [...live],
      // delay never resolves — the loop must advance via the handle settling, not a tick.
      delay: () => new Promise<void>(() => {}),
    });

    const p = drainAndExit(deps);
    live.delete(handle);
    settle();
    await p;

    expect(stop).not.toHaveBeenCalled();
    expect(deps.teardown).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it("stops stragglers and exits 0 when the grace budget elapses", async () => {
    const { handle, stop } = makeHandle();
    let clock = 0;
    const deps = baseDeps({
      graceMs: 250,
      isBusy: () => true,
      workerHandles: () => [handle],
      now: () => clock,
      // Each tick advances the clock past the deadline so the loop breaks.
      delay: async () => {
        clock += 1000;
      },
    });

    await drainAndExit(deps);

    expect(stop).toHaveBeenCalledWith("shutting down");
    expect(deps.teardown).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it("exits 1 when teardown throws, but still exits", async () => {
    const deps = baseDeps({
      isBusy: () => false,
      teardown: vi.fn(async () => {
        throw new Error("stopSlackApp failed");
      }),
    });
    await drainAndExit(deps);
    expect(deps.teardown).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("forces exit(1) on a second signal, running no further drain", async () => {
    const first = baseDeps({ isBusy: () => false });
    await drainAndExit(first);
    expect(first.exit).toHaveBeenCalledWith(0);

    // The `draining` latch is now set; a subsequent signal force-exits.
    const second = baseDeps({ isBusy: () => true });
    await drainAndExit(second);
    expect(second.exit).toHaveBeenCalledWith(1);
    expect(second.teardown).not.toHaveBeenCalled();
  });

  it("does not stack drains across repeated signals", async () => {
    await drainAndExit(baseDeps({ isBusy: () => false }));
    for (let i = 0; i < 3; i++) {
      const deps = baseDeps({ isBusy: () => true });
      await drainAndExit(deps);
      expect(deps.exit).toHaveBeenCalledWith(1);
      expect(deps.teardown).not.toHaveBeenCalled();
    }
  });
});
