import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../../plugins-sdk/testHelpers.js";
import type { ClackSdk } from "../../plugins-sdk/sdk.js";
import { en, fr } from "./i18n/strings.js";
import {
  loadBreakerState,
  saveBreakerState,
  windowKeyFor,
  recordEmptyFire,
  recordProductive,
} from "./breaker.js";
import type { IdlerWindow } from "./types.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

function buildSdk(tempDir: string): ClackSdk {
  const { sdk } = createClackSdk("idler", tempDir, {
    getSlackClient: () => null,
    loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
    openDmChannel: async () => null,
    clackQuery: emptyClackQuery,
    requestSoftRestart: () => {},
  });
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

  it("recordProductive resets counter while preserving other fields", async () => {
    await saveBreakerState(sdk, {
      windowKey: "2026-08-24",
      consecutiveEmpty: 3,
      pendingAsync: ["y"],
    });

    await recordProductive(sdk);

    const state = await loadBreakerState(sdk);
    assert.strictEqual(state.consecutiveEmpty, 0);
    assert.strictEqual(state.windowKey, "2026-08-24");
    assert.deepStrictEqual(state.pendingAsync, ["y"]);
  });
});
