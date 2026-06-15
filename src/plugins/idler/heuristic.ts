import type { IdlerWindow } from "./types.js";

/** Hours [0..23] INSIDE the window. Wraps past midnight when start >= end. */
export function windowHours(w: IdlerWindow): number[] {
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    const inWindow = w.start < w.end ? h >= w.start && h < w.end : h >= w.start || h < w.end;
    if (inWindow) hours.push(h);
  }
  return hours;
}

/** Hours [0..23] OUTSIDE the window — its complement. */
export function complementHours(w: IdlerWindow): number[] {
  const inside = new Set(windowHours(w));
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (!inside.has(h)) hours.push(h);
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
 * Cron firing at `minuteField` during the hours INSIDE the window, on its days. Used for the work
 * window (fire every 15 min while working) and for an explicitly-configured sync window.
 */
export function buildWindowCron(w: IdlerWindow, minuteField: string): string {
  return `${minuteField} ${compressToCronField(windowHours(w))} * * ${w.days.join(",")}`;
}

/**
 * Cron firing at `minuteField` during the hours OUTSIDE the window, on its days. Drives sync when no
 * explicit sync window is set: it primes the ledger throughout the non-work hours, and the last fire
 * before the work window opens hands off to the first work fire. `null` when the window covers every
 * hour (nothing left to sync) or no days are set.
 */
export function buildComplementCron(w: IdlerWindow, minuteField: string): string | null {
  const hours = complementHours(w);
  if (hours.length === 0 || w.days.length === 0) return null;
  return `${minuteField} ${compressToCronField(hours)} * * ${w.days.join(",")}`;
}

/** Summary fires once on the window's days — a morning digest. */
export function buildSummaryCron(w: IdlerWindow, hour: number): string {
  return `0 ${hour} * * ${w.days.join(",")}`;
}
