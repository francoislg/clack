import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { nextCronFireAfter, isLastFireBeforeSeasonEnd } from "./seasonStatus.js";
import { endOfMonthInZone } from "./monthBoundaries.js";

/**
 * The finale is detected by comparing the reveal cron's NEXT fire against the season's
 * `expectedEndAt` — a boundary these tests derive the way the season writers do. Both
 * halves read the game's timezone, so this pins the contract between them: the finale
 * lands on the last local reveal of the month, whatever hour that reveal fires at.
 */

/** Replays a month of reveals and returns the fire that `end_season` would close on. */
function findFinaleFire(
  revealCron: string,
  timezone: string,
  expectedEndAt: number,
  from: number,
): Date | null {
  let cursor = from;
  for (let i = 0; i < 100; i++) {
    const fire = nextCronFireAfter(revealCron, timezone, new Date(cursor));
    if (fire === null || fire.getTime() > expectedEndAt) return null;
    const following = nextCronFireAfter(revealCron, timezone, fire);
    if (isLastFireBeforeSeasonEnd(following, expectedEndAt)) return fire;
    cursor = fire.getTime();
  }
  return null;
}

function localDay(fire: Date | null, timezone: string): string | null {
  return fire === null ? null : fire.toLocaleDateString("en-CA", { timeZone: timezone });
}

describe("season finale timing", () => {
  const tz = "America/New_York";

  it("closes on the last local weekday for an evening reveal", () => {
    // July 2026 ends on Friday the 31st; a 9 PM EDT reveal is 01:00 UTC the NEXT day,
    // which is what pushed this fire past a UTC-derived boundary.
    const july = { year: 2026, month: 6 };
    const finale = findFinaleFire(
      "0 21 * * 1-5",
      tz,
      endOfMonthInZone(july, tz),
      Date.UTC(2026, 6, 1),
    );
    assert.equal(localDay(finale, tz), "2026-07-31");
  });

  it("closes on the last local weekday when the month ends on a Monday", () => {
    // November 2026 ends on Monday the 30th — a boundary that lands mid-week, so a
    // premature close skips the whole final weekend rather than a single day.
    const november = { year: 2026, month: 10 };
    const finale = findFinaleFire(
      "0 21 * * 1-5",
      tz,
      endOfMonthInZone(november, tz),
      Date.UTC(2026, 10, 1),
    );
    assert.equal(localDay(finale, tz), "2026-11-30");
  });

  it("closes on the last local weekday across the standard-time transition", () => {
    // DST ends Nov 1 2026 in New York, so the month opens at UTC-4 and closes at UTC-5.
    const november = { year: 2026, month: 10 };
    const finale = findFinaleFire(
      "0 13 * * 1-5",
      tz,
      endOfMonthInZone(november, tz),
      Date.UTC(2026, 10, 1),
    );
    assert.equal(localDay(finale, tz), "2026-11-30");
  });

  it("closes on the last local day for a daily reveal", () => {
    const july = { year: 2026, month: 6 };
    const finale = findFinaleFire(
      "0 22 * * *",
      tz,
      endOfMonthInZone(july, tz),
      Date.UTC(2026, 6, 1),
    );
    assert.equal(localDay(finale, tz), "2026-07-31");
  });

  it("closes on the last local weekday for a morning reveal", () => {
    const july = { year: 2026, month: 6 };
    const finale = findFinaleFire(
      "0 10 * * 1-5",
      tz,
      endOfMonthInZone(july, tz),
      Date.UTC(2026, 6, 1),
    );
    assert.equal(localDay(finale, tz), "2026-07-31");
  });

  it("closes on the last local day for a zone ahead of UTC", () => {
    const tokyo = "Asia/Tokyo";
    const july = { year: 2026, month: 6 };
    const finale = findFinaleFire(
      "0 9 * * *",
      tokyo,
      endOfMonthInZone(july, tokyo),
      Date.UTC(2026, 6, 1),
    );
    assert.equal(localDay(finale, tokyo), "2026-07-31");
  });

  it("closes a day early on a boundary that ignores the zone", () => {
    // A UTC month end reads as 19:59 local, so the fire after the 30th already sits
    // past it and the finale is claimed a day early.
    const utcMonthEnd = Date.UTC(2026, 7, 0, 23, 59, 59, 999);
    const finale = findFinaleFire("0 21 * * 1-5", tz, utcMonthEnd, Date.UTC(2026, 6, 1));
    assert.equal(localDay(finale, tz), "2026-07-30");
  });
});
