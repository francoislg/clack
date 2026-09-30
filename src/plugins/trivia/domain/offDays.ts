import type { OffDay } from "../core/configTypes.js";

/**
 * The first entry of `offDays` falling on `at`'s calendar date in `timezone` — an exact
 * `YYYY-MM-DD` or an annually-recurring `MM-DD` — or `null`. Same semantics as the core
 * scheduler's `skipDates` matching, which is how off-days reach the cron jobs. Throws
 * (RangeError) on an invalid IANA timezone.
 */
export function findOffDay(
  offDays: readonly OffDay[] | undefined,
  at: Date,
  timezone: string | undefined,
): OffDay | null {
  if (!offDays || offDays.length === 0) return null;
  const ymd = at.toLocaleDateString("en-CA", { timeZone: timezone });
  const md = ymd.slice(5);
  return offDays.find((d) => d.date === ymd || d.date === md) ?? null;
}
