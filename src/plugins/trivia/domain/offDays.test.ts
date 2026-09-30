import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { findOffDay } from "./offDays.js";
import type { OffDay } from "../core/configTypes.js";

const CHRISTMAS: OffDay = { date: "12-25", label: "Christmas" };
const ONE_OFF: OffDay = { date: "2026-09-30", label: "Off" };

describe("findOffDay", () => {
  it("returns null for undefined or empty off-days", () => {
    const at = new Date("2026-09-30T12:00:00Z");
    assert.equal(findOffDay(undefined, at, "UTC"), null);
    assert.equal(findOffDay([], at, "UTC"), null);
  });

  it("matches an exact YYYY-MM-DD entry on that date only", () => {
    assert.equal(findOffDay([ONE_OFF], new Date("2026-09-30T12:00:00Z"), "UTC"), ONE_OFF);
    assert.equal(findOffDay([ONE_OFF], new Date("2027-09-30T12:00:00Z"), "UTC"), null);
  });

  it("matches a recurring MM-DD entry in any year", () => {
    assert.equal(findOffDay([CHRISTMAS], new Date("2026-12-25T12:00:00Z"), "UTC"), CHRISTMAS);
    assert.equal(findOffDay([CHRISTMAS], new Date("2031-12-25T12:00:00Z"), "UTC"), CHRISTMAS);
    assert.equal(findOffDay([CHRISTMAS], new Date("2026-12-26T12:00:00Z"), "UTC"), null);
  });

  it("uses the calendar date in the given timezone", () => {
    // 02:00Z on Sept 30 is still Sept 29 in New York (EDT, UTC-4).
    const at = new Date("2026-09-30T02:00:00Z");
    const sept29: OffDay = { date: "2026-09-29", label: "Off" };
    assert.equal(findOffDay([sept29, ONE_OFF], at, "America/New_York"), sept29);
    assert.equal(findOffDay([ONE_OFF], at, "America/New_York"), null);
  });

  it("returns the first matching entry", () => {
    const dup: OffDay = { date: "2026-09-30", label: "Other" };
    assert.equal(findOffDay([ONE_OFF, dup], new Date("2026-09-30T12:00:00Z"), "UTC"), ONE_OFF);
  });

  it("throws on an invalid timezone", () => {
    assert.throws(() => findOffDay([ONE_OFF], new Date(), "Not/AZone"), RangeError);
  });
});
