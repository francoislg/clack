import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestClackSdk } from "../../plugins-sdk/testHelpers.js";
import type { ClackSdk } from "../../plugins-sdk/sdk.js";
import { en, fr } from "./i18n/strings.js";
import {
  loadBreakerState,
  saveBreakerState,
  windowKeyFor,
  recordEmptyFire,
  recordProductive,
  evaluateBreaker,
  recordAsyncTriggered,
  recordLift,
  type BreakerState,
} from "./breaker.js";
import { DEFAULT_CONFIG } from "./config.js";
import type { IdlerWindow } from "./types.js";

function buildSdk(tempDir: string): ClackSdk {
  const { sdk } = createTestClackSdk("idler", tempDir);
  sdk.registerDictionary({ en, fr });
  return sdk;
}

describe("breaker", () => {
  let tempDir: string;
  let sdk: ClackSdk;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idler-breaker-"));
    sdk = buildSdk(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loadBreakerState with no file returns zero state", async () => {
    const state = await loadBreakerState(sdk);
    assert.deepStrictEqual(state, { windowKey: "", consecutiveEmpty: 0, pendingAsync: [] });
  });

  it("loadBreakerState with corrupt file returns zero state", async () => {
    await sdk.writeFile("breaker.json", "not json{");
    const state = await loadBreakerState(sdk);
    assert.deepStrictEqual(state, { windowKey: "", consecutiveEmpty: 0, pendingAsync: [] });
  });

  it("windowKeyFor non-overnight window at 10:00 UTC on 2026-08-24", async () => {
    const window: IdlerWindow = { start: 9, end: 17, tz: "UTC", days: [1] };
    const date = new Date("2026-08-24T10:00:00Z");
    const key = windowKeyFor(window, date);
    assert.strictEqual(key, "2026-08-24");
  });

  it("windowKeyFor overnight window at 20:00 UTC on 2026-08-24", async () => {
    const window: IdlerWindow = { start: 18, end: 9, tz: "UTC", days: [1] };
    const date = new Date("2026-08-24T20:00:00Z");
    const key = windowKeyFor(window, date);
    assert.strictEqual(key, "2026-08-24");
  });

  it("windowKeyFor overnight window at 02:00 UTC on 2026-08-25 (pre-end) maps to previous day", async () => {
    const window: IdlerWindow = { start: 18, end: 9, tz: "UTC", days: [1] };
    const date = new Date("2026-08-25T02:00:00Z");
    const key = windowKeyFor(window, date);
    assert.strictEqual(key, "2026-08-24");
  });

  it("windowKeyFor overnight window at 08:00 UTC on 2026-08-25 (pre-end) maps to previous day", async () => {
    const window: IdlerWindow = { start: 18, end: 9, tz: "UTC", days: [1] };
    const date = new Date("2026-08-25T08:00:00Z");
    const key = windowKeyFor(window, date);
    assert.strictEqual(key, "2026-08-24");
  });

  it("recordEmptyFire increments counter in same window", async () => {
    const window: IdlerWindow = { start: 18, end: 9, tz: "UTC", days: [1] };
    const date = new Date("2026-08-24T20:00:00Z");

    const first = await recordEmptyFire(sdk, window, date);
    assert.strictEqual(first.consecutiveEmpty, 1);
    assert.strictEqual(first.windowKey, "2026-08-24");

    const second = await recordEmptyFire(sdk, window, date);
    assert.strictEqual(second.consecutiveEmpty, 2);
    assert.strictEqual(second.windowKey, "2026-08-24");
  });

  it("recordEmptyFire resets on window rollover", async () => {
    const window: IdlerWindow = { start: 18, end: 9, tz: "UTC", days: [1] };

    await saveBreakerState(sdk, {
      windowKey: "2026-08-23",
      consecutiveEmpty: 4,
      pendingAsync: ["x"],
    });

    const next = await recordEmptyFire(sdk, window, new Date("2026-08-24T20:00:00Z"));
    assert.strictEqual(next.windowKey, "2026-08-24");
    assert.strictEqual(next.consecutiveEmpty, 1);
    assert.deepStrictEqual(next.pendingAsync, []);
  });

  it("recordProductive resets counter and clears pendingAsync", async () => {
    await saveBreakerState(sdk, {
      windowKey: "2026-08-24",
      consecutiveEmpty: 3,
      pendingAsync: ["y"],
    });

    await recordProductive(sdk);

    const state = await loadBreakerState(sdk);
    assert.strictEqual(state.consecutiveEmpty, 0);
    assert.strictEqual(state.windowKey, "2026-08-24");
    assert.deepStrictEqual(state.pendingAsync, []);
  });

  describe("breaker trip/async/lift", () => {
    it("evaluateBreaker returns undefined when stopAfterEmptyRounds is 0", () => {
      const config = { ...DEFAULT_CONFIG, stopAfterEmptyRounds: 0 };
      const state: BreakerState = { windowKey: "", consecutiveEmpty: 5, pendingAsync: [] };
      const now = new Date("2026-08-24T20:00:00Z");
      const result = evaluateBreaker(config, state, now);
      assert.strictEqual(result, undefined);
    });

    it("evaluateBreaker tripped at threshold", () => {
      const config = { ...DEFAULT_CONFIG, stopAfterEmptyRounds: 2 };
      const now = new Date("2026-08-24T20:00:00Z");
      const key = windowKeyFor(config.workHours, now);
      const state: BreakerState = { windowKey: key, consecutiveEmpty: 2, pendingAsync: [] };
      const result = evaluateBreaker(config, state, now);
      assert.ok(result);
      assert.strictEqual(result.tripped, true);
      assert.strictEqual(result.consecutiveEmpty, 2);
      assert.strictEqual(result.threshold, 2);
    });

    it("evaluateBreaker not tripped below threshold", () => {
      const config = { ...DEFAULT_CONFIG, stopAfterEmptyRounds: 2 };
      const now = new Date("2026-08-24T20:00:00Z");
      const key = windowKeyFor(config.workHours, now);
      const state: BreakerState = { windowKey: key, consecutiveEmpty: 1, pendingAsync: [] };
      const result = evaluateBreaker(config, state, now);
      assert.ok(result);
      assert.strictEqual(result.tripped, false);
      assert.strictEqual(result.consecutiveEmpty, 1);
    });

    it("evaluateBreaker never trips on a stale windowKey", () => {
      const config = { ...DEFAULT_CONFIG, stopAfterEmptyRounds: 2 };
      const now = new Date("2026-08-24T20:00:00Z");
      const state: BreakerState = {
        windowKey: "1999-01-01",
        consecutiveEmpty: 9,
        pendingAsync: [],
      };
      const result = evaluateBreaker(config, state, now);
      assert.ok(result);
      assert.strictEqual(result.tripped, false);
      assert.strictEqual(result.consecutiveEmpty, 0);
    });

    it("recordAsyncTriggered adds a key and dedups", async () => {
      const now = new Date("2026-08-24T20:00:00Z");
      const firstCall = await recordAsyncTriggered(
        sdk,
        DEFAULT_CONFIG.workHours,
        now,
        "org/repo#1",
      );
      assert.deepStrictEqual(firstCall.pendingAsync, ["org/repo#1"]);
      assert.strictEqual(firstCall.consecutiveEmpty, 0);

      const secondCall = await recordAsyncTriggered(
        sdk,
        DEFAULT_CONFIG.workHours,
        now,
        "org/repo#1",
      );
      assert.deepStrictEqual(secondCall.pendingAsync, ["org/repo#1"]);
    });

    it("recordEmptyFire freezes while pendingAsync non-empty", async () => {
      const now = new Date("2026-08-24T20:00:00Z");
      const key = windowKeyFor(DEFAULT_CONFIG.workHours, now);
      await saveBreakerState(sdk, { windowKey: key, consecutiveEmpty: 1, pendingAsync: ["p"] });

      const result = await recordEmptyFire(sdk, DEFAULT_CONFIG.workHours, now);
      assert.strictEqual(result.consecutiveEmpty, 1);
      assert.deepStrictEqual(result.pendingAsync, ["p"]);
    });

    it("recordProductive clears pendingAsync and resets counter", async () => {
      await saveBreakerState(sdk, {
        windowKey: "k",
        consecutiveEmpty: 3,
        pendingAsync: ["a", "b"],
      });

      await recordProductive(sdk);

      const state = await loadBreakerState(sdk);
      assert.strictEqual(state.consecutiveEmpty, 0);
      assert.deepStrictEqual(state.pendingAsync, []);
    });

    it("recordLift resets counter but KEEPS pendingAsync", async () => {
      await saveBreakerState(sdk, {
        windowKey: "k",
        consecutiveEmpty: 3,
        pendingAsync: ["a"],
      });

      await recordLift(sdk);

      const state = await loadBreakerState(sdk);
      assert.strictEqual(state.consecutiveEmpty, 0);
      assert.deepStrictEqual(state.pendingAsync, ["a"]);
    });

    it("recordEmptyFire rollover clears pendingAsync", async () => {
      await saveBreakerState(sdk, {
        windowKey: "2026-08-23",
        consecutiveEmpty: 4,
        pendingAsync: ["stuck"],
      });

      const result = await recordEmptyFire(
        sdk,
        DEFAULT_CONFIG.workHours,
        new Date("2026-08-24T20:00:00Z"),
      );
      assert.strictEqual(result.windowKey, "2026-08-24");
      assert.strictEqual(result.consecutiveEmpty, 1);
      assert.deepStrictEqual(result.pendingAsync, []);
    });
  });
});
