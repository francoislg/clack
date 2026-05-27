import type { CasualTalkConfig, CasualTalkRate, CasualTalkWorkHours } from "./types.js";

/** Fixed cadence — every 15 minutes. 4 ticks per hour. v1 does not expose this as a config. */
const TICKS_PER_HOUR = 4;

/**
 * Compute `ticks_per_day` and `ticks_per_week` from `workHours`. End is exclusive, so a
 * 9-16 window has (16 - 9) = 7 hours × 4 ticks = 28 ticks/day.
 */
export function computeTicks(workHours: CasualTalkWorkHours): {
  ticksPerDay: number;
  ticksPerWeek: number;
} {
  const ticksPerDay = (workHours.end - workHours.start) * TICKS_PER_HOUR;
  const ticksPerWeek = ticksPerDay * workHours.days.length;
  return { ticksPerDay, ticksPerWeek };
}

/**
 * Map a named rate to a target die size given the available ticks. Larger die = lower
 * probability per tick. Rounded; the calling code clamps to `>= 1`.
 */
function rateToDieFromTicks(
  rate: CasualTalkRate,
  ticksPerDay: number,
  ticksPerWeek: number,
): number {
  switch (rate) {
    case "hourly":
      // ~8 posts/day for a typical 8-hour workday → ticksPerDay / 8.
      return ticksPerDay / 8;
    case "2-per-day":
      return ticksPerDay / 2;
    case "daily":
      return ticksPerDay;
    case "2-per-week":
      return ticksPerWeek / 2;
    case "weekly":
      return ticksPerWeek;
  }
}

/**
 * Resolve the roll-die size for the current config. Explicit `die` wins over `expectedRate`.
 * Result is rounded to the nearest integer and clamped to `>= 1`.
 */
export function resolveDie(config: CasualTalkConfig): number {
  if (config.die !== undefined) {
    return Math.max(1, Math.round(config.die));
  }
  const { ticksPerDay, ticksPerWeek } = computeTicks(config.workHours);
  const raw = rateToDieFromTicks(config.expectedRate, ticksPerDay, ticksPerWeek);
  return Math.max(1, Math.round(raw));
}

/**
 * Build the cron expression from `workHours`. Fixed 15-minute cadence (every quarter
 * hour); hour range is `start..(end-1)` (cron is inclusive on both ends, but our `end`
 * is exclusive). Days are joined with commas.
 *
 * Example: `{ start: 9, end: 16, days: [1,2,3,4,5] }` produces the string
 * `every-15-min 9-15 each month all days [1..5]`.
 */
export function buildCronExpression(workHours: CasualTalkWorkHours): string {
  const hourRange = `${workHours.start}-${workHours.end - 1}`;
  const days = workHours.days.join(",");
  return `*/15 ${hourRange} * * ${days}`;
}

/** Pretty label for embedding in the prompt — e.g. "rate: daily (1/28)". */
export function rateLabel(rate: CasualTalkRate, die: number): string {
  return `${rate} (1/${die})`;
}
