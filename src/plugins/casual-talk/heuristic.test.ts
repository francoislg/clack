import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildCronExpression, computeTicks, rateLabel, resolveDie } from "./heuristic.js";
import type { CasualTalkConfig, CasualTalkWorkHours } from "./types.js";

function baseConfig(overrides: Partial<CasualTalkConfig> = {}): CasualTalkConfig {
  return {
    enabled: true,
    channels: ["C123"],
    workHours: { start: 9, end: 16, tz: "UTC", days: [1, 2, 3, 4, 5] },
    expectedRate: "daily",
    smallTalkTopics: [],
    useBuiltinFallbackTopics: true,
    ...overrides,
  };
}

describe("casual-talk heuristic", () => {
  describe("computeTicks", () => {
    it("9-16 weekdays = 28 ticks/day, 140 ticks/week", () => {
      const wh: CasualTalkWorkHours = { start: 9, end: 16, tz: "UTC", days: [1, 2, 3, 4, 5] };
      const { ticksPerDay, ticksPerWeek } = computeTicks(wh);
      assert.equal(ticksPerDay, 28);
      assert.equal(ticksPerWeek, 140);
    });

    it("9-17 weekdays = 32 ticks/day, 160 ticks/week", () => {
      const wh: CasualTalkWorkHours = { start: 9, end: 17, tz: "UTC", days: [1, 2, 3, 4, 5] };
      const { ticksPerDay, ticksPerWeek } = computeTicks(wh);
      assert.equal(ticksPerDay, 32);
      assert.equal(ticksPerWeek, 160);
    });

    it("0-24 all-day every-day = 96 ticks/day, 672 ticks/week", () => {
      const wh: CasualTalkWorkHours = { start: 0, end: 24, tz: "UTC", days: [0, 1, 2, 3, 4, 5, 6] };
      const { ticksPerDay, ticksPerWeek } = computeTicks(wh);
      assert.equal(ticksPerDay, 96);
      assert.equal(ticksPerWeek, 672);
    });
  });

  describe("resolveDie — named rates over 9-16 weekdays (28 ticks/day, 140/week)", () => {
    it("hourly = 28/8 → rounded to 4", () => {
      assert.equal(resolveDie(baseConfig({ expectedRate: "hourly" })), 4);
    });

    it("2-per-day = 28/2 = 14", () => {
      assert.equal(resolveDie(baseConfig({ expectedRate: "2-per-day" })), 14);
    });

    it("daily = 28", () => {
      assert.equal(resolveDie(baseConfig({ expectedRate: "daily" })), 28);
    });

    it("2-per-week = 140/2 = 70", () => {
      assert.equal(resolveDie(baseConfig({ expectedRate: "2-per-week" })), 70);
    });

    it("weekly = 140", () => {
      assert.equal(resolveDie(baseConfig({ expectedRate: "weekly" })), 140);
    });
  });

  describe("resolveDie — die override", () => {
    it("explicit die wins over rate", () => {
      assert.equal(resolveDie(baseConfig({ expectedRate: "weekly", die: 17 })), 17);
    });

    it("clamps die to >= 1", () => {
      assert.equal(resolveDie(baseConfig({ die: 0 })), 1);
      assert.equal(resolveDie(baseConfig({ die: -5 })), 1);
    });

    it("rounds die to nearest integer", () => {
      // die: 4.6 → 5
      assert.equal(resolveDie(baseConfig({ die: 4.6 })), 5);
    });

    it("clamps named-rate result to >= 1 (corner case)", () => {
      // If config somehow has end == start+1 with only 1 day and "weekly" rate, ticks_per_week
      // = 4 * 1 * 1 = 4. weekly maps to 4, fine. Try an extreme case: hourly over a 1-hour day
      // = (1-hour * 4 ticks) / 8 = 0.5 → rounded to 1 (clamped).
      const result = resolveDie(
        baseConfig({
          workHours: { start: 9, end: 10, tz: "UTC", days: [1] },
          expectedRate: "hourly",
        }),
      );
      assert.equal(result, 1, "hourly over 1-hour day clamps to 1");
    });
  });

  describe("buildCronExpression", () => {
    it("9-16 weekdays produces */15 9-15 * * 1,2,3,4,5", () => {
      const expr = buildCronExpression({
        start: 9,
        end: 16,
        tz: "UTC",
        days: [1, 2, 3, 4, 5],
      });
      assert.equal(expr, "*/15 9-15 * * 1,2,3,4,5");
    });

    it("0-24 every-day produces */15 0-23 * * 0,1,2,3,4,5,6", () => {
      const expr = buildCronExpression({
        start: 0,
        end: 24,
        tz: "UTC",
        days: [0, 1, 2, 3, 4, 5, 6],
      });
      assert.equal(expr, "*/15 0-23 * * 0,1,2,3,4,5,6");
    });

    it("single-day single-hour window", () => {
      const expr = buildCronExpression({ start: 12, end: 13, tz: "UTC", days: [3] });
      assert.equal(expr, "*/15 12-12 * * 3");
    });
  });

  describe("rateLabel", () => {
    it("formats as '<rate> (1/<die>)'", () => {
      assert.equal(rateLabel("daily", 28), "daily (1/28)");
      assert.equal(rateLabel("weekly", 160), "weekly (1/160)");
    });
  });
});
