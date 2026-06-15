import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { humanReadableSchedule } from "./cronFormatter.js";

describe("humanReadableSchedule", () => {
  it("formats daily schedule", () => {
    const result = humanReadableSchedule("0 9 * * *", "America/New_York");
    assert.match(result, /Every day at/);
    assert.match(result, /9:00/);
  });

  it("formats weekly schedule", () => {
    const result = humanReadableSchedule("0 9 * * 1", "UTC");
    assert.match(result, /Mon/);
    assert.match(result, /9:00/);
  });

  it("formats weekday schedule", () => {
    const result = humanReadableSchedule("0 9 * * 1-5", "UTC");
    assert.match(result, /Weekdays at/);
  });

  it("formats monthly schedule", () => {
    const result = humanReadableSchedule("0 9 15 * *", "UTC");
    assert.match(result, /Day 15/);
  });

  it("formats hourly schedule on the hour", () => {
    const result = humanReadableSchedule("0 * * * *", "UTC");
    assert.equal(result, "Every hour");
  });

  it("formats hourly schedule with non-zero minute", () => {
    const result = humanReadableSchedule("30 * * * *", "UTC");
    assert.equal(result, "Every hour at :30");
  });

  it("formats every-N-hours schedule", () => {
    const result = humanReadableSchedule("0 */2 * * *", "UTC");
    assert.equal(result, "Every 2 hours");
  });

  it("formats every-minute schedule", () => {
    const result = humanReadableSchedule("* * * * *", "UTC");
    assert.equal(result, "Every minute");
  });

  it("formats every-N-minutes schedule (step form)", () => {
    const result = humanReadableSchedule("*/15 * * * *", "UTC");
    assert.equal(result, "Every 15 minutes");
  });

  it("formats every-N-minutes schedule (list form)", () => {
    const result = humanReadableSchedule("0,30 * * * *", "UTC");
    assert.equal(result, "Every 30 minutes");
  });

  it("does not collapse partial minute lists into N-minutes", () => {
    // 0,15 covers only first quarter of the hour — not equivalent to */15
    const result = humanReadableSchedule("0,15 * * * *", "UTC");
    assert.equal(result, "Every hour at :0,15");
  });

  it("formats sub-daily with hour range and weekday restriction", () => {
    const result = humanReadableSchedule("*/15 10-14 * * 1-5", "UTC");
    assert.equal(result, "Every 15 minutes from 10 AM to 2 PM on weekdays");
  });

  it("formats hourly with weekday restriction", () => {
    const result = humanReadableSchedule("0 * * * 1-5", "UTC");
    assert.equal(result, "Every hour on weekdays");
  });

  it("formats hourly with hour range", () => {
    const result = humanReadableSchedule("0 9-17 * * *", "UTC");
    assert.equal(result, "Every hour from 9 AM to 5 PM");
  });

  it("formats sub-daily with single-day restriction", () => {
    const result = humanReadableSchedule("*/30 * * * 1", "UTC");
    assert.equal(result, "Every 30 minutes on Mon");
  });

  it("formats every-N-hours with weekday restriction", () => {
    const result = humanReadableSchedule("0 */2 * * 1-5", "UTC");
    assert.equal(result, "Every 2 hours on weekdays");
  });

  it("formats sub-daily across midnight-anchored hour range", () => {
    const result = humanReadableSchedule("0 0-6 * * *", "UTC");
    assert.equal(result, "Every hour from 12 AM to 6 AM");
  });

  it("merges a comma-listed off-hours complement into one wrap-around window", () => {
    const result = humanReadableSchedule("0 0-8,18-23 * * 1-5", "UTC");
    assert.equal(result, "Every hour from 6 PM to 8 AM on weekdays");
  });

  it("describes the off-hours work cron with its minute step", () => {
    const result = humanReadableSchedule("*/15 0-8,18-23 * * 1-5", "UTC");
    assert.equal(result, "Every 15 minutes from 6 PM to 8 AM on weekdays");
  });

  it("treats 0-6 dayOfWeek as every day in sub-daily form", () => {
    const result = humanReadableSchedule("*/15 * * * 0-6", "UTC");
    assert.equal(result, "Every 15 minutes");
  });

  it("falls through to weekly form when hour is a single value", () => {
    const result = humanReadableSchedule("0 9 * * 1-5", "UTC");
    assert.match(result, /Weekdays at/);
  });

  it("returns raw expression for invalid cron", () => {
    const result = humanReadableSchedule("invalid", "UTC");
    assert.equal(result, "invalid");
  });
});

describe("humanReadableSchedule viewer-relative timezone", () => {
  it("appends the abbreviation when no viewer timezone is given", () => {
    const result = humanReadableSchedule("0 9 * * *", "UTC");
    assert.match(result, /UTC/);
  });

  it("omits the abbreviation when the job zone matches the viewer zone", () => {
    const result = humanReadableSchedule("0 9 * * *", "UTC", "UTC");
    assert.equal(result, "Every day at 9:00 AM");
  });

  it("shows the abbreviation when the job zone differs from the viewer zone", () => {
    const result = humanReadableSchedule("0 9 * * *", "UTC", "America/New_York");
    assert.match(result, /UTC/);
  });

  it("treats equivalent zones (same abbreviation) as matching", () => {
    // America/New_York and America/Montreal share an abbreviation at any instant.
    const result = humanReadableSchedule("0 9 * * *", "America/New_York", "America/Montreal");
    assert.equal(result, "Every day at 9:00 AM");
  });

  it("falls back to showing the abbreviation when the viewer zone is invalid", () => {
    const result = humanReadableSchedule("0 9 * * *", "UTC", "Not/AZone");
    assert.match(result, /UTC/);
  });
});
