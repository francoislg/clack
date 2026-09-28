import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestClackSdk } from "../../plugins-sdk/testHelpers.js";
import type { ClackSdk } from "../../plugins-sdk/sdk.js";
import { appendActivity, clearActivity, loadActivity } from "./activity.js";

function buildSdk(tempDir: string): ClackSdk {
  const { sdk } = createTestClackSdk("idler", tempDir);
  return sdk;
}

describe("activity log", () => {
  let tempDir: string;
  let sdk: ClackSdk;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idler-activity-log-"));
    sdk = buildSdk(tempDir);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("starts empty", async () => {
    assert.deepEqual(await loadActivity(sdk), { entries: [] });
  });

  it("appends entries in order", async () => {
    await appendActivity(sdk, { at: "2026-06-15T01:00:00Z", kind: "pr_opened", detail: "PR #1" });
    await appendActivity(sdk, {
      at: "2026-06-15T02:00:00Z",
      kind: "review",
      detail: "reviewed #1",
    });
    const log = await loadActivity(sdk);
    assert.equal(log.entries.length, 2);
    assert.equal(log.entries[0].kind, "pr_opened");
    assert.equal(log.entries[1].kind, "review");
  });

  it("clears the log", async () => {
    await appendActivity(sdk, { at: "2026-06-15T01:00:00Z", kind: "failure", detail: "boom" });
    await clearActivity(sdk);
    assert.deepEqual((await loadActivity(sdk)).entries, []);
  });

  it("clear stamps windowStart with the current time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-06-15T09:00:00.000Z"));
    await appendActivity(sdk, { at: "2026-06-15T01:00:00Z", kind: "failure", detail: "boom" });
    await clearActivity(sdk);
    assert.deepEqual(await loadActivity(sdk), {
      entries: [],
      windowStart: Date.parse("2026-06-15T09:00:00.000Z"),
    });
  });

  it("append preserves an existing windowStart", async () => {
    await sdk.writeFile(
      "activity.json",
      JSON.stringify({ entries: [], windowStart: 1_750_000_000_000 }),
    );
    await appendActivity(sdk, { at: "2026-06-15T01:00:00Z", kind: "review", detail: "r" });
    const log = await loadActivity(sdk);
    assert.equal(log.windowStart, 1_750_000_000_000);
    assert.equal(log.entries.length, 1);
  });

  it("parses a legacy log without windowStart", async () => {
    await sdk.writeFile(
      "activity.json",
      JSON.stringify({ entries: [{ at: "2026-06-15T01:00:00Z", kind: "review", detail: "r" }] }),
    );
    const log = await loadActivity(sdk);
    assert.equal(log.entries.length, 1);
    assert.equal(log.windowStart, undefined);
  });

  it("reads malformed log as empty, never throws", async () => {
    await sdk.writeFile("activity.json", "{bad");
    assert.deepEqual(await loadActivity(sdk), { entries: [] });
  });
});
