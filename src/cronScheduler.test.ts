import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { humanReadableSchedule } from "./cronScheduler.js";

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
});
