import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  activeHours,
  buildActiveHoursCron,
  buildOffHoursCron,
  buildSummaryCron,
  compressToCronField,
  offDays,
  offHours,
} from "./heuristic.js";
import type { IdlerActiveHours } from "./types.js";

const active: IdlerActiveHours = {
  start: 9,
  end: 18,
  tz: "America/Montreal",
  days: [1, 2, 3, 4, 5],
};

describe("offHours / offDays", () => {
  it("returns the complement of the active hour window", () => {
    assert.deepEqual(offHours(active), [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23]);
  });

  it("returns the days not in the active set", () => {
    assert.deepEqual(offDays(active), [0, 6]);
  });

  it("activeHours is the exact complement of offHours", () => {
    assert.deepEqual(activeHours(active), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it("has no off-days when every day is active", () => {
    assert.deepEqual(offDays({ ...active, days: [0, 1, 2, 3, 4, 5, 6] }), []);
  });
});

describe("compressToCronField", () => {
  it("compresses consecutive runs into ranges", () => {
    assert.equal(compressToCronField([0, 1, 2, 18, 19]), "0-2,18-19");
  });
  it("keeps singletons", () => {
    assert.equal(compressToCronField([0, 6]), "0,6");
  });
  it("handles empty", () => {
    assert.equal(compressToCronField([]), "");
  });
});

describe("buildOffHoursCron", () => {
  it("builds an active-days expression over the off-hours, every 15 min", () => {
    const { offHoursActiveDays } = buildOffHoursCron(active, "*/15");
    assert.equal(offHoursActiveDays, "*/15 0-8,18-23 * * 1,2,3,4,5");
  });

  it("builds an all-hours non-active-days expression for weekends", () => {
    const { offHoursNonActiveDays } = buildOffHoursCron(active, "0");
    assert.equal(offHoursNonActiveDays, "0 * * * 0,6");
  });

  it("yields null non-active-days when the active window covers every day", () => {
    const everyDay = { ...active, days: [0, 1, 2, 3, 4, 5, 6] };
    assert.equal(buildOffHoursCron(everyDay, "0").offHoursNonActiveDays, null);
  });
});

describe("buildActiveHoursCron", () => {
  it("fires hourly over the active window on active days, at the given minute", () => {
    assert.equal(buildActiveHoursCron(active, "45"), "45 9-17 * * 1,2,3,4,5");
  });

  it("is exclusive of the off-hours work window (no shared hour)", () => {
    const sync = buildActiveHoursCron(active, "45");
    const { offHoursActiveDays } = buildOffHoursCron(active, "*/15");
    // sync hours 9-17, work hours 0-8,18-23 — disjoint.
    assert.equal(sync, "45 9-17 * * 1,2,3,4,5");
    assert.equal(offHoursActiveDays, "*/15 0-8,18-23 * * 1,2,3,4,5");
  });

  it("returns null when the active window leaves no active hours", () => {
    assert.equal(buildActiveHoursCron({ ...active, start: 0, end: 0 }, "45"), null);
  });

  it("returns null when no days are active", () => {
    assert.equal(buildActiveHoursCron({ ...active, days: [] }, "45"), null);
  });
});

describe("buildSummaryCron", () => {
  it("fires at the active-window start on active days", () => {
    assert.equal(buildSummaryCron(active, active.start), "0 9 * * 1,2,3,4,5");
  });

  it("fires at an explicit summary hour decoupled from the window start", () => {
    assert.equal(buildSummaryCron(active, 8), "0 8 * * 1,2,3,4,5");
  });
});
