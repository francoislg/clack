import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  activeHours,
  buildActiveHoursCron,
  buildOffHoursCron,
  buildSummaryCron,
  compressToCronField,
  offHours,
} from "./heuristic.js";
import type { IdlerActiveHours } from "./types.js";

const active: IdlerActiveHours = {
  start: 9,
  end: 18,
  tz: "America/Montreal",
  days: [1, 2, 3, 4, 5],
};

describe("offHours", () => {
  it("returns the complement of the active hour window", () => {
    assert.deepEqual(offHours(active), [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23]);
  });

  it("activeHours is the exact complement of offHours", () => {
    assert.deepEqual(activeHours(active), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
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
  it("builds an off-hours expression over the active days only, every 15 min", () => {
    assert.equal(buildOffHoursCron(active, "*/15"), "*/15 0-8,18-23 * * 1,2,3,4,5");
  });

  it("never schedules work on non-active days (weekends stay idle)", () => {
    const dayField = buildOffHoursCron(active, "*/15").split(" ").slice(4).join(" ");
    assert.equal(dayField, "1,2,3,4,5");
  });
});

describe("buildActiveHoursCron", () => {
  it("fires hourly over the active window on active days, at the given minute", () => {
    assert.equal(buildActiveHoursCron(active, "45"), "45 9-17 * * 1,2,3,4,5");
  });

  it("is exclusive of the off-hours work window (no shared hour)", () => {
    // sync hours 9-17, work hours 0-8,18-23 — disjoint.
    assert.equal(buildActiveHoursCron(active, "45"), "45 9-17 * * 1,2,3,4,5");
    assert.equal(buildOffHoursCron(active, "*/15"), "*/15 0-8,18-23 * * 1,2,3,4,5");
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
