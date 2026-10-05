import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { startOfMonthInZone, endOfMonthInZone, nextMonth, monthInZone } from "./monthBoundaries.js";

/**
 * Sweeps the boundary helpers across zones with awkward DST rules — midnight
 * transitions (Havana, Santiago), a 30-minute shift (Lord Howe), a half-hour base
 * offset (Kolkata, Chatham), the date line (Kiritimati, Apia) and the southern
 * hemisphere — so a zone whose offset changes AT a month boundary can't quietly
 * produce a window that starts or ends on the wrong local day.
 */
const ZONES = [
  "UTC",
  "America/New_York",
  "America/Havana",
  "America/Santiago",
  "America/Sao_Paulo",
  "Europe/Paris",
  "Europe/Dublin",
  "Africa/Cairo",
  "Asia/Tehran",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Lord_Howe",
  "Australia/Sydney",
  "Pacific/Chatham",
  "Pacific/Kiritimati",
  "Pacific/Apia",
];

const YEARS = [2024, 2025, 2026, 2027];

function parts(instant: number, timeZone: string): { day: string; hour: string } {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const at = (type: Intl.DateTimeFormatPartTypes): string =>
    formatted.find((p) => p.type === type)?.value ?? "";
  return {
    day: `${at("year")}-${at("month")}-${at("day")}`,
    hour: `${at("hour")}:${at("minute")}`,
  };
}

function eachMonth(visit: (year: number, month: number, zone: string) => void): void {
  for (const zone of ZONES) {
    for (const year of YEARS) {
      for (let month = 0; month < 12; month++) visit(year, month, zone);
    }
  }
}

// Each case sweeps 768 zone-months; under a loaded full-suite run that can pass the 5s default.
describe("month boundary invariants across DST-awkward zones", { timeout: 30_000 }, () => {
  it("starts each month on its local first day", () => {
    eachMonth((year, month, zone) => {
      const { day } = parts(startOfMonthInZone({ year, month }, zone), zone);
      const expected = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      assert.equal(day, expected, `${zone} ${expected}: start landed on ${day}`);
    });
  });

  it("starts each month at local midnight, or at the first instant a midnight gap allows", () => {
    eachMonth((year, month, zone) => {
      const { hour } = parts(startOfMonthInZone({ year, month }, zone), zone);
      // A spring-forward that lands exactly on midnight (Havana, Santiago) makes 00:00
      // nonexistent; the boundary then resolves to the first instant of the local day.
      assert.ok(
        hour === "00:00" || hour === "00:30" || hour === "01:00",
        `${zone} ${year}-${month + 1}: start read ${hour}`,
      );
    });
  });

  it("ends each month on its local last day", () => {
    eachMonth((year, month, zone) => {
      const end = endOfMonthInZone({ year, month }, zone);
      const { day } = parts(end, zone);
      const lastLocalDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const expected = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastLocalDay).padStart(2, "0")}`;
      assert.equal(day, expected, `${zone} ${expected}: end landed on ${day}`);
    });
  });

  it("closes each month exactly one millisecond before the next begins", () => {
    eachMonth((year, month, zone) => {
      const end = endOfMonthInZone({ year, month }, zone);
      const nextStart = startOfMonthInZone(nextMonth({ year, month }), zone);
      assert.equal(end + 1, nextStart, `${zone} ${year}-${month + 1}: gap between months`);
    });
  });

  it("round-trips a month through its own boundaries", () => {
    eachMonth((year, month, zone) => {
      const start = startOfMonthInZone({ year, month }, zone);
      const end = endOfMonthInZone({ year, month }, zone);
      assert.deepEqual(monthInZone(start, zone), { year, month }, `${zone} start round-trip`);
      assert.deepEqual(monthInZone(end, zone), { year, month }, `${zone} end round-trip`);
    });
  });
});
