import type { IdlerActiveHours } from "./types.js";

/** Hours [0..23] that fall OUTSIDE the active window (its complement). */
export function offHours(active: IdlerActiveHours): number[] {
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (h < active.start || h >= active.end) hours.push(h);
  }
  return hours;
}

/** Hours [0..23] INSIDE the active window — the complement of `offHours`. */
export function activeHours(active: IdlerActiveHours): number[] {
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (h >= active.start && h < active.end) hours.push(h);
  }
  return hours;
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

/**
 * Build the off-hours work cron: the hour-complement of the active window, on active days only.
 * Non-active days (e.g. weekends) stay idle so review work doesn't pile up unbounded.
 */
export function buildOffHoursCron(active: IdlerActiveHours, minuteField: string): string {
  return `${minuteField} ${compressToCronField(offHours(active))} * * ${active.days.join(",")}`;
}

/**
 * Build the sync cron: hourly during the active window on active days, exclusive of the off-hours
 * work window. The minute is offset (e.g. "45") so the last active-hour fire primes the ledger just
 * before work opens. Returns `null` when there are no active hours or no active days to schedule.
 */
export function buildActiveHoursCron(active: IdlerActiveHours, minuteField: string): string | null {
  const hours = activeHours(active);
  if (hours.length === 0 || active.days.length === 0) return null;
  return `${minuteField} ${compressToCronField(hours)} * * ${active.days.join(",")}`;
}

/** Summary fires once on active days — a morning digest. `hour` defaults to the active-window start. */
export function buildSummaryCron(active: IdlerActiveHours, hour: number): string {
  return `0 ${hour} * * ${active.days.join(",")}`;
}
