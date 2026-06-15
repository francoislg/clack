import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  buildComplementCron,
  buildSummaryCron,
  buildWindowCron,
  complementHours,
  compressToCronField,
  windowHours,
} from "./heuristic.js";
import type { IdlerWindow } from "./types.js";

const overnight: IdlerWindow = {
  start: 18,
  end: 9,
  tz: "America/Montreal",
  days: [1, 2, 3, 4, 5],
};

const evening: IdlerWindow = {
  start: 19,
  end: 20,
  tz: "America/Montreal",
  days: [1, 2, 3, 4, 5],
};

describe("windowHours / complementHours", () => {
  it("returns the hours inside a non-wrapping window", () => {
    assert.deepEqual(windowHours(evening), [19]);
  });

  it("wraps past midnight when start >= end", () => {
    assert.deepEqual(windowHours(overnight), [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23]);
  });

  it("complementHours is the exact complement", () => {
    assert.deepEqual(complementHours(overnight), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
    assert.deepEqual(
      complementHours(evening),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23],
    );
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

describe("buildWindowCron", () => {
  it("fires inside an overnight work window, every 15 min, on work days only", () => {
    assert.equal(buildWindowCron(overnight, "*/15"), "*/15 0-8,18-23 * * 1,2,3,4,5");
  });

  it("expresses a single interior hour like 7–8 PM", () => {
    assert.equal(buildWindowCron(evening, "*/15"), "*/15 19 * * 1,2,3,4,5");
  });

  it("never schedules on days outside the window (weekends stay idle)", () => {
    const dayField = buildWindowCron(evening, "*/15").split(" ").slice(4).join(" ");
    assert.equal(dayField, "1,2,3,4,5");
  });
});

describe("buildComplementCron", () => {
  it("fires outside the work window on its days, at the given minute", () => {
    assert.equal(buildComplementCron(overnight, "45"), "45 9-17 * * 1,2,3,4,5");
  });

  it("is disjoint from the work window (no shared hour)", () => {
    assert.equal(buildWindowCron(overnight, "*/15"), "*/15 0-8,18-23 * * 1,2,3,4,5");
    assert.equal(buildComplementCron(overnight, "45"), "45 9-17 * * 1,2,3,4,5");
  });

  it("returns null when the window covers every hour", () => {
    assert.equal(buildComplementCron({ ...overnight, start: 0, end: 24 }, "45"), null);
  });

  it("returns null when no days are set", () => {
    assert.equal(buildComplementCron({ ...overnight, days: [] }, "45"), null);
  });
});

describe("buildSummaryCron", () => {
  it("fires at the given hour on the window's days", () => {
    assert.equal(buildSummaryCron(overnight, 9), "0 9 * * 1,2,3,4,5");
  });

  it("fires at an explicit summary hour", () => {
    assert.equal(buildSummaryCron(overnight, 8), "0 8 * * 1,2,3,4,5");
  });
});
