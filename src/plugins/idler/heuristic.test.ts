import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  buildDeepSyncCron,
  buildDiscoverySyncCron,
  buildLightSyncCron,
  buildSummaryCron,
  buildWindowCron,
  complementHours,
  compressToCronField,
  discoveryHour,
  syncSchedule,
  thinHours,
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

describe("thinHours", () => {
  it("returns the hours unchanged at step 1", () => {
    assert.deepEqual(thinHours([9, 10, 11], 1, 11), [9, 10, 11]);
  });

  it("keeps the anchor and every 2nd hour walking backwards from it", () => {
    assert.deepEqual(thinHours([9, 10, 11, 12, 13, 14, 15, 16, 17], 2, 17), [9, 11, 13, 15, 17]);
  });

  it("walks chronologically across midnight in a wrapped complement", () => {
    assert.deepEqual(
      thinHours(complementHours(evening), 2, 18),
      [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
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
  it("returns a lone hour as-is", () => {
    assert.equal(compressToCronField([5]), "5");
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

describe("syncSchedule", () => {
  it("uses the complement of the work window, anchored on the hour before work opens", () => {
    const s = syncSchedule(overnight);
    assert.deepEqual(s.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
    assert.equal(s.anchor, 17);
    assert.deepEqual(s.days, [1, 2, 3, 4, 5]);
  });

  it("uses an explicit sync window, anchored on its own last hour", () => {
    const sync: IdlerWindow = { start: 9, end: 18, tz: "UTC", days: [1, 2, 3, 4, 5] };
    const s = syncSchedule(overnight, sync);
    assert.deepEqual(s.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
    assert.equal(s.anchor, 17);
    assert.deepEqual(s.days, [1, 2, 3, 4, 5]);
  });

  it("anchors chronologically for an interior (wrapped-complement) work window", () => {
    const s = syncSchedule(evening);
    assert.equal(s.anchor, 18);
    assert.ok(s.hours.includes(18));
  });

  it("carries the explicit sync window's own days, even when they differ from workHours", () => {
    const sync: IdlerWindow = { start: 9, end: 18, tz: "UTC", days: [6, 0] };
    assert.deepEqual(syncSchedule(overnight, sync).days, [6, 0]);
  });
});

describe("buildDeepSyncCron", () => {
  it("fires once at the anchor hour on the schedule's days", () => {
    assert.equal(buildDeepSyncCron(syncSchedule(overnight), "45"), "45 17 * * 1,2,3,4,5");
  });

  it("returns null when the work window covers every hour", () => {
    assert.equal(buildDeepSyncCron(syncSchedule({ ...overnight, start: 0, end: 24 }), "45"), null);
  });

  it("returns null when no days are set", () => {
    assert.equal(buildDeepSyncCron(syncSchedule({ ...overnight, days: [] }), "45"), null);
  });
});

describe("discoveryHour / buildDiscoverySyncCron", () => {
  it("picks the thinned slot immediately before the anchor", () => {
    assert.equal(discoveryHour(syncSchedule(overnight), 2), 15);
    assert.equal(buildDiscoverySyncCron(syncSchedule(overnight), "45", 2), "45 15 * * 1,2,3,4,5");
  });

  it("picks anchor − 1 at cadence 1", () => {
    assert.equal(discoveryHour(syncSchedule(overnight), 1), 16);
  });

  it("wraps past midnight when anchor − step goes negative", () => {
    // Work window 3→18: complement 18..23,0..2, anchor 2; candidate (2 − 4) mod 24 = 22.
    const wrapped: IdlerWindow = { start: 3, end: 18, tz: "UTC", days: [1, 2, 3, 4, 5] };
    assert.equal(discoveryHour(syncSchedule(wrapped), 4), 22);
  });

  it("returns null for a single-hour sync window", () => {
    const sync: IdlerWindow = { start: 8, end: 9, tz: "UTC", days: [1, 2, 3, 4, 5] };
    assert.equal(discoveryHour(syncSchedule(overnight, sync), 2), null);
    assert.equal(buildDiscoverySyncCron(syncSchedule(overnight, sync), "45", 2), null);
  });

  it("returns null when the candidate falls outside an explicit small sync window", () => {
    // syncHours 16→18 = {16, 17}, anchor 17; candidate 15 is outside the window.
    const sync: IdlerWindow = { start: 16, end: 18, tz: "UTC", days: [1, 2, 3, 4, 5] };
    assert.equal(discoveryHour(syncSchedule(overnight, sync), 2), null);
  });

  it("returns null when no days are set", () => {
    assert.equal(buildDiscoverySyncCron(syncSchedule({ ...overnight, days: [] }), "45", 2), null);
  });
});

describe("buildLightSyncCron", () => {
  it("thins to every 2nd hour and excludes the anchor and discovery hours", () => {
    assert.equal(buildLightSyncCron(syncSchedule(overnight), "45", 2), "45 9,11,13 * * 1,2,3,4,5");
  });

  it("fires every hour except anchor and discovery at cadence 1", () => {
    assert.equal(buildLightSyncCron(syncSchedule(overnight), "45", 1), "45 9-15 * * 1,2,3,4,5");
  });

  it("thins to every 4th hour at a wider cadence", () => {
    assert.equal(buildLightSyncCron(syncSchedule(overnight), "45", 4), "45 9 * * 1,2,3,4,5");
  });

  it("light ∪ {discovery} ∪ {anchor} equals the thinned sync schedule", () => {
    const s = syncSchedule(overnight);
    const light = buildLightSyncCron(s, "45", 2)!.split(" ")[1].split(",").map(Number);
    assert.deepEqual(
      [...light, discoveryHour(s, 2)!, s.anchor].sort((a, b) => a - b),
      thinHours(s.hours, 2, s.anchor),
    );
  });

  it("fallback (no discovery hour) implies no light fires either — deep-only layout", () => {
    // Sync windows are contiguous, so a discovery candidate outside the window means every other
    // thinned candidate is outside too: the thinned schedule is just the anchor.
    // syncHours 16→18 = {16, 17}, anchor 17, step 2 → thinned {17}, candidate 15 outside.
    const sync: IdlerWindow = { start: 16, end: 18, tz: "UTC", days: [1, 2, 3, 4, 5] };
    const s = syncSchedule(overnight, sync);
    assert.equal(discoveryHour(s, 2), null);
    assert.equal(buildLightSyncCron(s, "45", 2), null);
  });

  it("a two-hour window at cadence 1 splits into deep + discovery with no light", () => {
    const sync: IdlerWindow = { start: 16, end: 18, tz: "UTC", days: [1, 2, 3, 4, 5] };
    const s = syncSchedule(overnight, sync);
    assert.equal(discoveryHour(s, 1), 16);
    assert.equal(buildLightSyncCron(s, "45", 1), null);
  });

  it("returns null for a single-hour sync window (only the deep fire remains)", () => {
    const sync: IdlerWindow = { start: 8, end: 9, tz: "UTC", days: [1, 2, 3, 4, 5] };
    assert.equal(buildLightSyncCron(syncSchedule(overnight, sync), "45", 2), null);
  });

  it("returns null when no days are set", () => {
    assert.equal(buildLightSyncCron(syncSchedule({ ...overnight, days: [] }), "45", 2), null);
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
