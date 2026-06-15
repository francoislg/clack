import type { IdlerActiveHours } from "./types.js";

/** Hours [0..23] that fall OUTSIDE the active window (its complement). */
export function offHours(active: IdlerActiveHours): number[] {
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (h < active.start || h >= active.end) hours.push(h);
  }
  return hours;
}

/** Days [0..6] NOT in the active set — whole-day idler-eligible. */
export function offDays(active: IdlerActiveHours): number[] {
  const set = new Set(active.days);
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !set.has(d));
}

/** Compress a sorted unique number list into a cron field ("0,1,2,18,19" → "0-2,18-19"). */
export function compressToCronField(values: number[]): string {
  if (values.length === 0) return "";
  const sorted = [...values].sort((a, b) => a - b);
  const parts: string[] = [];
  let runStart = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(runStart === prev ? `${runStart}` : `${runStart}-${prev}`);
    runStart = cur;
    prev = cur;
  }
  return parts.join(",");
}

export interface IdlerCronExpressions {
  /** Off-hours on active days (hour complement, active day set). */
  offHoursActiveDays: string;
  /** All hours on non-active days. `null` when the active window covers every day. */
  offHoursNonActiveDays: string | null;
}

/**
 * Build the off-hours cron expression(s) for a given minute field. Off-hours work splits in two:
 * the hour-complement on active days, and (if any) every hour on non-active days. Callers emit
 * one spec per non-null field, sharing the task prompt.
 */
export function buildOffHoursCron(
  active: IdlerActiveHours,
  minuteField: string,
): IdlerCronExpressions {
  const hourField = compressToCronField(offHours(active));
  const activeDayField = active.days.join(",");
  const nonActive = offDays(active);
  return {
    offHoursActiveDays: `${minuteField} ${hourField} * * ${activeDayField}`,
    offHoursNonActiveDays:
      nonActive.length > 0 ? `${minuteField} * * * ${nonActive.join(",")}` : null,
  };
}

/** Summary fires once at the active-window start on active days — a morning digest before work. */
export function buildSummaryCron(active: IdlerActiveHours): string {
  return `0 ${active.start} * * ${active.days.join(",")}`;
}
