import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { humanReadableSchedule, matchesCron } from "./cronScheduler.js";

describe("cronScheduler", () => {
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

    it("returns raw expression for invalid cron", () => {
      const result = humanReadableSchedule("invalid", "UTC");
      assert.equal(result, "invalid");
    });
  });

  describe("matchesCron", () => {
    it("matches when now is within the cron minute", () => {
      // Cron fires at minute 0 of every hour; check at HH:00:30
      const now = new Date("2026-03-31T09:00:30Z");
      assert.equal(matchesCron("0 9 * * *", now, "UTC"), true);
    });

    it("does not match when outside the cron minute", () => {
      const now = new Date("2026-03-31T09:01:30Z");
      assert.equal(matchesCron("0 9 * * *", now, "UTC"), false);
    });

    it("does not match before the cron time", () => {
      const now = new Date("2026-03-31T08:59:30Z");
      assert.equal(matchesCron("0 9 * * *", now, "UTC"), false);
    });

    it("skips when lastRunAt already covers this cron time", () => {
      const now = new Date("2026-03-31T09:00:55Z");
      const lastRunAt = new Date("2026-03-31T09:00:10Z").toISOString();
      assert.equal(matchesCron("0 9 * * *", now, "UTC", lastRunAt), false);
    });

    it("fires when lastRunAt is from a previous cron time", () => {
      const now = new Date("2026-03-31T09:00:30Z");
      const lastRunAt = new Date("2026-03-30T09:00:10Z").toISOString();
      assert.equal(matchesCron("0 9 * * *", now, "UTC", lastRunAt), true);
    });

    it("fires when no lastRunAt is set", () => {
      const now = new Date("2026-03-31T09:00:30Z");
      assert.equal(matchesCron("0 9 * * *", now, "UTC", undefined), true);
    });
  });
});
