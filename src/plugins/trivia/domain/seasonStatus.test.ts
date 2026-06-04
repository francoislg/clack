import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { nextCronFireAfter, isLastFireBeforeSeasonEnd } from "./seasonStatus.js";

describe("nextCronFireAfter", () => {
  it("returns the next fire of a valid cron strictly after the given instant", () => {
    const after = new Date("2020-06-15T00:00:00.000Z");
    const next = nextCronFireAfter("0 0 1 1 *", "UTC", after);
    assert.equal(next?.toISOString(), "2021-01-01T00:00:00.000Z");
  });

  it("honors the timezone", () => {
    const after = new Date("2020-06-15T12:00:00.000Z");
    // 09:00 in America/Montreal (EDT, UTC-4 in June) → 13:00 UTC the same day.
    const next = nextCronFireAfter("0 9 * * *", "America/Montreal", after);
    assert.equal(next?.toISOString(), "2020-06-15T13:00:00.000Z");
  });

  it("parses with a default zone when timezone is undefined", () => {
    const after = new Date("2020-06-15T00:00:00.000Z");
    const next = nextCronFireAfter("0 0 * * *", undefined, after);
    assert.ok(next instanceof Date, "a valid cron yields a Date even without an explicit tz");
  });

  it("returns null (logs) for an unparseable cron expression", () => {
    const next = nextCronFireAfter("not a cron", "UTC", new Date("2020-06-15T00:00:00.000Z"));
    assert.equal(next, null);
  });
});

describe("isLastFireBeforeSeasonEnd", () => {
  const END = Date.UTC(2020, 11, 31, 23, 59, 59, 999);

  it("is true when the next fire lands after the season end", () => {
    assert.equal(isLastFireBeforeSeasonEnd(new Date(END + 1000), END), true);
  });

  it("is false when the next fire lands before the season end", () => {
    assert.equal(isLastFireBeforeSeasonEnd(new Date(END - 1000), END), false);
  });

  it("treats a null next fire (unparseable cron) as the last fire", () => {
    assert.equal(isLastFireBeforeSeasonEnd(null, END), true);
  });
});
