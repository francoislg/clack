import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  isLastFireBeforeSeasonEnd,
  nextCronFireAfter,
  nextRevealFireAfter,
  resolveLastFireOfSeason,
} from "./seasonStatus.js";
import { findOffDay } from "./offDays.js";
import type { OffDay } from "../core/configTypes.js";

vi.mock("./offDays.js", () => ({ findOffDay: vi.fn() }));

beforeEach(() => {
  vi.mocked(findOffDay).mockReset();
});

const WEEKDAY_REVEAL = "0 17 * * 1-5";
const NEW_YORK = "America/New_York";

function offOnDates(...dates: string[]): void {
  vi.mocked(findOffDay).mockImplementation((_entries, at) => {
    const date = dates.find((d) => at.toISOString().startsWith(d));
    return date === undefined ? null : { date, label: "Off" };
  });
}

describe("nextCronFireAfter", () => {
  it("returns the next fire of a valid cron strictly after the given instant", () => {
    const after = new Date("2020-06-15T00:00:00.000Z");
    const next = nextCronFireAfter("0 0 1 1 *", "UTC", after);
    assert.equal(next?.toISOString(), "2021-01-01T00:00:00.000Z");
  });

  it("honors the timezone", () => {
    const after = new Date("2020-06-15T12:00:00.000Z");
    // 09:00 in America/New_York (EDT, UTC-4 in June) → 13:00 UTC the same day.
    const next = nextCronFireAfter("0 9 * * *", "America/New_York", after);
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

describe("nextRevealFireAfter", () => {
  // Tue Sept 29 2026, 18:00 EDT.
  const after = new Date("2026-09-29T22:00:00Z");
  const offDays: OffDay[] = [{ date: "2026-09-30", label: "Off" }];

  it("equals nextCronFireAfter when no fire matches an off-day", () => {
    vi.mocked(findOffDay).mockReturnValue(null);
    assert.equal(
      nextRevealFireAfter(WEEKDAY_REVEAL, NEW_YORK, after, offDays)?.toISOString(),
      nextCronFireAfter(WEEKDAY_REVEAL, NEW_YORK, after)?.toISOString(),
    );
  });

  it("checks each fire against the off-days in the reveal's timezone", () => {
    vi.mocked(findOffDay).mockReturnValue(null);
    nextRevealFireAfter(WEEKDAY_REVEAL, NEW_YORK, after, offDays);
    expect(findOffDay).toHaveBeenCalledWith(
      offDays,
      new Date("2026-09-30T21:00:00.000Z"),
      NEW_YORK,
    );
  });

  it("skips a fire that lands on an off-day", () => {
    offOnDates("2026-09-30");
    const next = nextRevealFireAfter(WEEKDAY_REVEAL, NEW_YORK, after, offDays);
    assert.equal(next?.toISOString(), "2026-10-01T21:00:00.000Z");
  });

  it("skips consecutive off-days", () => {
    offOnDates("2026-09-30", "2026-10-01");
    const next = nextRevealFireAfter(WEEKDAY_REVEAL, NEW_YORK, after, offDays);
    assert.equal(next?.toISOString(), "2026-10-02T21:00:00.000Z");
  });

  it("returns null for an unparseable cron without consulting the off-days", () => {
    assert.equal(nextRevealFireAfter("not a cron", NEW_YORK, after, offDays), null);
    expect(findOffDay).not.toHaveBeenCalled();
  });

  it("returns null when every fire within the bound lands on an off-day", () => {
    vi.mocked(findOffDay).mockReturnValue({ date: "2026-09-30", label: "Off" });
    assert.equal(nextRevealFireAfter(WEEKDAY_REVEAL, NEW_YORK, after, offDays), null);
  });
});

describe("resolveLastFireOfSeason", () => {
  const now = new Date("2026-09-29T22:00:00Z");

  it("is not the last fire (and has no next fire) without a revealCron", () => {
    for (const revealCron of [undefined, ""]) {
      assert.deepEqual(
        resolveLastFireOfSeason({
          revealCron,
          timezone: NEW_YORK,
          now,
          offDays: undefined,
          expectedEndAt: now.getTime() + 1000,
        }),
        { nextFire: null, isLastFireOfSeason: false },
      );
    }
  });

  it("is the last fire when the next reveal lands after expectedEndAt", () => {
    vi.mocked(findOffDay).mockReturnValue(null);
    const result = resolveLastFireOfSeason({
      revealCron: WEEKDAY_REVEAL,
      timezone: NEW_YORK,
      now,
      offDays: undefined,
      expectedEndAt: new Date("2026-09-30T12:00:00Z").getTime(),
    });
    assert.deepEqual(result, {
      nextFire: new Date("2026-09-30T21:00:00.000Z"),
      isLastFireOfSeason: true,
    });
  });

  it("is not the last fire when the next reveal lands before expectedEndAt", () => {
    vi.mocked(findOffDay).mockReturnValue(null);
    const result = resolveLastFireOfSeason({
      revealCron: WEEKDAY_REVEAL,
      timezone: NEW_YORK,
      now,
      offDays: undefined,
      expectedEndAt: new Date("2026-10-01T03:59:59.999Z").getTime(),
    });
    assert.deepEqual(result, {
      nextFire: new Date("2026-09-30T21:00:00.000Z"),
      isLastFireOfSeason: false,
    });
  });
});
