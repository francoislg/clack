/**
 * Timezone-aware calendar-month boundaries for season windows.
 *
 * A season's `expectedEndAt` is compared against reveal-cron fire instants, which fire
 * in the GAME's timezone, so every boundary here resolves in the supplied zone rather
 * than UTC. An absent or unrecognized zone falls back to UTC.
 */
import { triviaLogger as logger } from "../core/pluginLogger.js";

/** `month` is 0-indexed (0 = January) — the shape `Date.UTC` takes. */
export interface CalendarMonth {
  year: number;
  month: number;
}

const UTC = "UTC";

function resolveZone(timezone: string | undefined): string {
  if (timezone === undefined || timezone.length === 0) return UTC;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch (error) {
    logger.warn(
      `monthBoundaries: unrecognized timezone "${timezone}" — falling back to UTC: ${error instanceof Error ? error.message : String(error)}`,
    );
    return UTC;
  }
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const part = parts.find((p) => p.type === type);
  if (part === undefined) {
    throw new Error(`monthBoundaries: Intl produced no "${type}" part`);
  }
  return Number(part.value);
}

/**
 * The offset (ms) to ADD to `instant` to get the wall-clock reading in `zone`,
 * expressed as a UTC instant. `America/New_York` in July returns -4h.
 */
function zoneOffsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const asUtc = Date.UTC(
    readPart(parts, "year"),
    readPart(parts, "month") - 1,
    readPart(parts, "day"),
    readPart(parts, "hour"),
    readPart(parts, "minute"),
    readPart(parts, "second"),
  );
  return asUtc - instant;
}

/**
 * The UTC instant at which local midnight on the 1st of `month` occurs in `zone`.
 *
 * Two passes: the first offset is read at the naive instant, the second at the
 * corrected one. They differ only across a DST transition, where the naive instant
 * sits on the far side of the change; re-reading at the corrected instant lands on
 * the offset actually in force. A zone that springs forward exactly at midnight
 * (Havana, Santiago) has no local 00:00 that day, and the boundary resolves to the
 * first instant the local day does reach.
 */
function startOfMonthInstant(month: CalendarMonth, zone: string): number {
  const naive = Date.UTC(month.year, month.month, 1, 0, 0, 0, 0);
  const firstPass = naive - zoneOffsetMs(naive, zone);
  return naive - zoneOffsetMs(firstPass, zone);
}

/** The calendar month containing `instant` as read in `timezone`. */
export function monthInZone(instant: number, timezone: string | undefined): CalendarMonth {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveZone(timezone),
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(instant));
  return { year: readPart(parts, "year"), month: readPart(parts, "month") - 1 };
}

/** The month after `month`, rolling the year over at December. */
export function nextMonth(month: CalendarMonth): CalendarMonth {
  return month.month === 11
    ? { year: month.year + 1, month: 0 }
    : { year: month.year, month: month.month + 1 };
}

/** The UTC instant of the first millisecond of `month` in `timezone`. */
export function startOfMonthInZone(month: CalendarMonth, timezone: string | undefined): number {
  return startOfMonthInstant(month, resolveZone(timezone));
}

/** The UTC instant of the last millisecond of `month` in `timezone`. */
export function endOfMonthInZone(month: CalendarMonth, timezone: string | undefined): number {
  return startOfMonthInZone(nextMonth(month), timezone) - 1;
}

/** The `season-YYYY-MM` slug naming `month`. */
export function seasonSlug(month: CalendarMonth): string {
  return `season-${month.year}-${String(month.month + 1).padStart(2, "0")}`;
}
