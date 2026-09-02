import { describe, it, expect } from "vitest";
import {
  monthInZone,
  nextMonth,
  startOfMonthInZone,
  endOfMonthInZone,
  seasonSlug,
} from "./monthBoundaries.js";

/** Renders an instant as a wall-clock reading in `tz`, for readable assertions. */
function wallClock(instant: number, tz: string): string {
  return new Date(instant).toLocaleString("sv-SE", { timeZone: tz });
}

describe("monthInZone", () => {
  it("reads the month from the zone's calendar, not UTC's", () => {
    // 2026-08-01T01:00Z is still July 31, 9 PM in New York.
    const instant = Date.UTC(2026, 7, 1, 1, 0, 0);
    expect(monthInZone(instant, "America/New_York")).toEqual({ year: 2026, month: 6 });
    expect(monthInZone(instant, "UTC")).toEqual({ year: 2026, month: 7 });
  });

  it("reads ahead of UTC for a positive-offset zone", () => {
    // 2026-07-31T23:00Z is already August 1, 8 AM in Tokyo.
    const instant = Date.UTC(2026, 6, 31, 23, 0, 0);
    expect(monthInZone(instant, "Asia/Tokyo")).toEqual({ year: 2026, month: 7 });
    expect(monthInZone(instant, "UTC")).toEqual({ year: 2026, month: 6 });
  });

  it("falls back to UTC for an absent or unrecognized zone", () => {
    const instant = Date.UTC(2026, 7, 1, 1, 0, 0);
    expect(monthInZone(instant, undefined)).toEqual({ year: 2026, month: 7 });
    expect(monthInZone(instant, "")).toEqual({ year: 2026, month: 7 });
    expect(monthInZone(instant, "Not/AZone")).toEqual({ year: 2026, month: 7 });
  });
});

describe("nextMonth", () => {
  it("advances within a year", () => {
    expect(nextMonth({ year: 2026, month: 6 })).toEqual({ year: 2026, month: 7 });
  });

  it("rolls the year over at December", () => {
    expect(nextMonth({ year: 2026, month: 11 })).toEqual({ year: 2027, month: 0 });
  });
});

describe("startOfMonthInZone", () => {
  it("lands on local midnight for a negative-offset zone", () => {
    const start = startOfMonthInZone({ year: 2026, month: 6 }, "America/New_York");
    expect(wallClock(start, "America/New_York")).toBe("2026-07-01 00:00:00");
    // EDT is UTC-4, so local midnight is 04:00Z.
    expect(start).toBe(Date.UTC(2026, 6, 1, 4, 0, 0));
  });

  it("lands on local midnight for a positive-offset zone", () => {
    const start = startOfMonthInZone({ year: 2026, month: 6 }, "Asia/Tokyo");
    expect(wallClock(start, "Asia/Tokyo")).toBe("2026-07-01 00:00:00");
    expect(start).toBe(Date.UTC(2026, 5, 30, 15, 0, 0));
  });

  it("uses the standard-time offset for a winter month", () => {
    // EST is UTC-5, so January's local midnight is 05:00Z — not July's 04:00Z.
    const start = startOfMonthInZone({ year: 2026, month: 0 }, "America/New_York");
    expect(start).toBe(Date.UTC(2026, 0, 1, 5, 0, 0));
  });

  it("falls back to UTC without a zone", () => {
    expect(startOfMonthInZone({ year: 2026, month: 6 }, undefined)).toBe(Date.UTC(2026, 6, 1));
  });
});

describe("endOfMonthInZone", () => {
  it("is the last local millisecond of the month", () => {
    const end = endOfMonthInZone({ year: 2026, month: 6 }, "America/New_York");
    expect(wallClock(end, "America/New_York")).toBe("2026-07-31 23:59:59");
    expect(end).toBe(Date.UTC(2026, 7, 1, 3, 59, 59, 999));
  });

  it("sits four hours later than the UTC month end it replaces", () => {
    const utcMonthEnd = Date.UTC(2026, 7, 0, 23, 59, 59, 999);
    const zoned = endOfMonthInZone({ year: 2026, month: 6 }, "America/New_York");
    expect(zoned - utcMonthEnd).toBe(4 * 60 * 60 * 1000);
  });

  it("rolls the year over for December", () => {
    const end = endOfMonthInZone({ year: 2026, month: 11 }, "America/New_York");
    expect(wallClock(end, "America/New_York")).toBe("2026-12-31 23:59:59");
    expect(end).toBe(Date.UTC(2027, 0, 1, 5, 0, 0) - 1);
  });

  it("uses the offset in force at the month's end, not its start", () => {
    // DST ends Nov 1 2026 in New York: the month opens at UTC-4 and closes at UTC-5.
    const end = endOfMonthInZone({ year: 2026, month: 10 }, "America/New_York");
    expect(wallClock(end, "America/New_York")).toBe("2026-11-30 23:59:59");
    expect(end).toBe(Date.UTC(2026, 11, 1, 5, 0, 0) - 1);
  });

  it("resolves a month whose first local midnight follows a spring-forward", () => {
    // Lord Howe shifts on Oct 4 2026; the month boundary itself is unaffected but the
    // two-pass offset read must not land on the pre-transition offset.
    const end = endOfMonthInZone({ year: 2026, month: 9 }, "Australia/Lord_Howe");
    expect(wallClock(end, "Australia/Lord_Howe")).toBe("2026-10-31 23:59:59");
  });

  it("falls back to UTC without a zone", () => {
    expect(endOfMonthInZone({ year: 2026, month: 6 }, undefined)).toBe(
      Date.UTC(2026, 7, 0, 23, 59, 59, 999),
    );
  });
});

describe("seasonSlug", () => {
  it("zero-pads the month", () => {
    expect(seasonSlug({ year: 2026, month: 0 })).toBe("season-2026-01");
    expect(seasonSlug({ year: 2026, month: 11 })).toBe("season-2026-12");
  });
});
