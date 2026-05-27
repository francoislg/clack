import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { casualTalkConfigSchema, DEFAULT_CONFIG } from "./config.js";

describe("casual-talk config schema", () => {
  it("accepts the DEFAULT_CONFIG (round-trip)", () => {
    const result = casualTalkConfigSchema.safeParse(DEFAULT_CONFIG);
    assert.ok(result.success, JSON.stringify(result.error?.issues));
  });

  it("accepts a minimal valid config with one channel and one topic", () => {
    const result = casualTalkConfigSchema.safeParse({
      enabled: true,
      channels: ["C123"],
      workHours: { start: 9, end: 16, tz: "UTC", days: [1, 2, 3, 4, 5] },
      expectedRate: "daily",
      smallTalkTopics: ["food"],
    });
    assert.ok(result.success);
  });

  it("accepts a channel entry with promptSuggestion", () => {
    const result = casualTalkConfigSchema.safeParse({
      enabled: true,
      channels: [{ id: "C123", promptSuggestion: "memes only" }],
      workHours: { start: 9, end: 16, tz: "UTC", days: [1, 2, 3, 4, 5] },
      expectedRate: "daily",
      smallTalkTopics: [],
    });
    assert.ok(result.success);
  });

  it("accepts an explicit die override", () => {
    const result = casualTalkConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      die: 50,
    });
    assert.ok(result.success);
  });

  it("rejects invalid channel ID shapes", () => {
    const result = casualTalkConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      channels: ["not-a-channel-id"],
    });
    assert.equal(result.success, false);
  });

  it("rejects workHours where start >= end (no wrap-around)", () => {
    const result = casualTalkConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      workHours: { start: 20, end: 8, tz: "UTC", days: [1, 2, 3, 4, 5] },
    });
    assert.equal(result.success, false);
  });

  it("rejects empty days array", () => {
    const result = casualTalkConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      workHours: { start: 9, end: 16, tz: "UTC", days: [] },
    });
    assert.equal(result.success, false);
  });

  it("rejects out-of-range day values", () => {
    const result = casualTalkConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      workHours: { start: 9, end: 16, tz: "UTC", days: [7] },
    });
    assert.equal(result.success, false);
  });

  it("rejects an invalid IANA timezone string", () => {
    const result = casualTalkConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      workHours: { start: 9, end: 16, tz: "Not/A/Timezone", days: [1, 2, 3, 4, 5] },
    });
    assert.equal(result.success, false);
  });

  it("rejects an out-of-range start hour", () => {
    const result = casualTalkConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      workHours: { start: 24, end: 25, tz: "UTC", days: [1] },
    });
    assert.equal(result.success, false);
  });

  it("rejects die < 1", () => {
    const result = casualTalkConfigSchema.safeParse({ ...DEFAULT_CONFIG, die: 0 });
    assert.equal(result.success, false);
  });

  it("rejects unknown expectedRate", () => {
    const result = casualTalkConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      expectedRate: "monthly",
    });
    assert.equal(result.success, false);
  });

  it("accepts end === 24 (midnight)", () => {
    const result = casualTalkConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      workHours: { start: 0, end: 24, tz: "UTC", days: [1, 2, 3, 4, 5] },
    });
    assert.ok(result.success);
  });
});
