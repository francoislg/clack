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
 * Keep every `step`-th hour, walking chronologically backwards from `anchorHour` (always kept).
 * Anchoring on the hour that matters most (the one just before the work window opens) means the
 * fires dropped by a sparser cadence are always the least important ones.
 */
export function thinHours(hours: number[], step: number, anchorHour: number): number[] {
  if (step <= 1) return hours;
  return hours.filter((h) => ((((anchorHour - h) % 24) + 24) % 24) % step === 0);
}

/**
 * Cron firing at `minuteField` during the hours INSIDE the window, on its days. Used for the work
 * window (fire every 15 min while working).
 */
export function buildWindowCron(w: IdlerWindow, minuteField: string): string {
  return `${minuteField} ${compressToCronField(windowHours(w))} * * ${w.days.join(",")}`;
}

/**
 * The hours the sync task may fire, its anchor hour, and its days — resolved from config. When an
 * explicit `syncHours` window is set, sync runs inside it and the anchor is its own last hour;
 * otherwise sync runs in the complement of `workHours` and the anchor is the hour just before work
 * opens (the handoff fire that primes the ledger for the first work fire). The anchor is always a
 * member of `hours` unless `hours` is empty (a work window covering every hour).
 */
export interface SyncSchedule {
  hours: number[];
  anchor: number;
  days: number[];
}

export function syncSchedule(workHours: IdlerWindow, syncHours?: IdlerWindow): SyncSchedule {
  if (syncHours) {
    return {
      hours: windowHours(syncHours),
      anchor: (syncHours.end - 1 + 24) % 24,
      days: syncHours.days,
    };
  }
  return {
    hours: complementHours(workHours),
    anchor: (workHours.start - 1 + 24) % 24,
    days: workHours.days,
  };
}

/**
 * The deep sync cron — the full-maintenance fire that runs once per sync-window day at the anchor
 * hour, right before the work window opens. `null` when the schedule has no days or no hours (a
 * work window covering every hour leaves nothing to sync).
 */
export function buildDeepSyncCron(s: SyncSchedule, minuteField: string): string | null {
  if (s.days.length === 0 || !s.hours.includes(s.anchor)) return null;
  return `${minuteField} ${s.anchor} * * ${s.days.join(",")}`;
}

/**
 * The hour the discovery fire owns: the thinned sync slot immediately before the anchor,
 * `(anchor − stepHours) mod 24`. `null` when that hour is outside the thinned sync schedule or
 * collides with the anchor (single-hour / too-small windows) — the caller then falls back to the
 * combined maintenance-plus-discovery fire at the anchor.
 */
export function discoveryHour(s: SyncSchedule, stepHours: number): number | null {
  const candidate = (((s.anchor - stepHours) % 24) + 24) % 24;
  if (candidate === s.anchor) return null;
  return thinHours(s.hours, stepHours, s.anchor).includes(candidate) ? candidate : null;
}

/**
 * The discovery sync cron — the once-per-window-day external-discovery fire at `discoveryHour`.
 * `null` when no eligible hour exists or no days are set; the deep fire then runs the combined
 * pass instead.
 */
export function buildDiscoverySyncCron(
  s: SyncSchedule,
  minuteField: string,
  stepHours: number,
): string | null {
  const hour = discoveryHour(s, stepHours);
  if (hour === null || s.days.length === 0) return null;
  return `${minuteField} ${hour} * * ${s.days.join(",")}`;
}

/**
 * The light sync cron — the cheap memory-triage fire firing every `stepHours` across the sync
 * window, EXCLUDING the anchor hour (which the deep fire owns) and the discovery hour (which the
 * discovery fire owns, when one exists). Thinning is anchored on the anchor hour, so
 * light ∪ {discovery} ∪ {anchor} equals the thinned sync schedule and every hour is owned by
 * exactly one spec. `null` when nothing remains (a single-hour sync window) or no days are set.
 */
export function buildLightSyncCron(
  s: SyncSchedule,
  minuteField: string,
  stepHours: number,
): string | null {
  const discovery = discoveryHour(s, stepHours);
  const hours = thinHours(s.hours, stepHours, s.anchor).filter(
    (h) => h !== s.anchor && h !== discovery,
  );
  if (hours.length === 0 || s.days.length === 0) return null;
  return `${minuteField} ${compressToCronField(hours)} * * ${s.days.join(",")}`;
}

/** Summary fires once on the window's days — a morning digest. */
export function buildSummaryCron(w: IdlerWindow, hour: number): string {
  return `0 ${hour} * * ${w.days.join(",")}`;
}
