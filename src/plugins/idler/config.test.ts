import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, idlerConfigSchema, isOperational } from "./config.js";
import type { IdlerConfig } from "./types.js";

function base(overrides: Partial<IdlerConfig> = {}): IdlerConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe("idlerConfigSchema", () => {
  it("accepts the default config", () => {
    assert.ok(idlerConfigSchema.safeParse(DEFAULT_CONFIG).success);
  });

  it("defaults optional fields (caps, sources, allowlist)", () => {
    const parsed = idlerConfigSchema.parse({
      enabled: true,
      workHours: { start: 18, end: 9, tz: "UTC", days: [1] },
    });
    assert.equal(parsed.maxActionsPerFire, 1);
    assert.equal(parsed.maxActionsPerNight, 5);
    assert.deepEqual(parsed.repoAllowlist, []);
    assert.equal(parsed.sources.ownPrs, true);
  });

  it("accepts an overnight (wrapping) work window", () => {
    const ok = idlerConfigSchema.safeParse({
      enabled: true,
      workHours: { start: 18, end: 9, tz: "UTC", days: [1] },
    });
    assert.equal(ok.success, true);
  });

  it("accepts an explicit syncHours window", () => {
    const ok = idlerConfigSchema.safeParse({
      enabled: true,
      workHours: { start: 19, end: 20, tz: "UTC", days: [1, 2, 3, 4, 5] },
      syncHours: { start: 9, end: 18, tz: "UTC", days: [1, 2, 3, 4, 5] },
    });
    assert.equal(ok.success, true);
  });

  it("rejects a window whose start equals its end", () => {
    const bad = idlerConfigSchema.safeParse({
      enabled: true,
      workHours: { start: 9, end: 9, tz: "UTC", days: [1] },
    });
    assert.equal(bad.success, false);
  });

  it("rejects an invalid timezone", () => {
    const bad = idlerConfigSchema.safeParse({
      enabled: true,
      workHours: { start: 18, end: 9, tz: "Not/AZone", days: [1] },
    });
    assert.equal(bad.success, false);
  });

  it("rejects an out-of-range summaryHour", () => {
    const bad = idlerConfigSchema.safeParse({
      enabled: true,
      workHours: { start: 18, end: 9, tz: "UTC", days: [1] },
      summaryHour: 24,
    });
    assert.equal(bad.success, false);
  });

  it("rejects a malformed channel id", () => {
    const bad = idlerConfigSchema.safeParse({
      enabled: true,
      workHours: { start: 18, end: 9, tz: "UTC", days: [1] },
      reportingChannel: "not-a-channel",
    });
    assert.equal(bad.success, false);
  });
});

describe("isOperational", () => {
  it("is false by default (disabled)", () => {
    assert.equal(isOperational(DEFAULT_CONFIG), false);
  });

  it("requires enabled + an allowlisted repo + a reporting channel", () => {
    assert.equal(isOperational(base({ enabled: true })), false);
    assert.equal(isOperational(base({ enabled: true, repoAllowlist: ["r"] })), false);
    assert.equal(
      isOperational(base({ enabled: true, repoAllowlist: ["r"], reportingChannel: "C123" })),
      true,
    );
  });
});
