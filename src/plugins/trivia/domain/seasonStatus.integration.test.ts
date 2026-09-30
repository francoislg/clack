import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveLastFireOfSeason } from "./seasonStatus.js";
import type { OffDay } from "../core/configTypes.js";

describe("end of season on an off-day", () => {
  // End of Sept 30 2026 in America/New_York (EDT, UTC-4).
  const expectedEndAt = new Date("2026-10-01T03:59:59.999Z").getTime();
  // Just after the Tue Sept 29 reveal, 17:00 EDT.
  const now = new Date("2026-09-29T21:00:01Z");

  function resolve(offDays: readonly OffDay[] | undefined) {
    return resolveLastFireOfSeason({
      revealCron: "0 17 * * 1-5",
      timezone: "America/New_York",
      now,
      offDays,
      expectedEndAt,
    });
  }

  it("treats the reveal before an off-day season end as the last fire", () => {
    const result = resolve([{ date: "2026-09-30", label: "Off" }]);
    assert.equal(result.isLastFireOfSeason, true);
    assert.equal(result.nextFire?.toISOString(), "2026-10-01T21:00:00.000Z");
  });

  it("honors a recurring MM-DD off-day", () => {
    const result = resolve([{ date: "09-30", label: "Annual" }]);
    assert.equal(result.isLastFireOfSeason, true);
    assert.equal(result.nextFire?.toISOString(), "2026-10-01T21:00:00.000Z");
  });

  it("does not treat it as the last fire when the final day is not off", () => {
    assert.equal(resolve(undefined).isLastFireOfSeason, false);
  });
});
