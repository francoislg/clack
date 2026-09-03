/**
 * Pure derivation of a season's temporal phase windows and the phase-selection
 * helpers the cascade builder uses to source the `seasonPhase` tier. No I/O.
 *
 * A season declares an ordered list of `PhaseSlice`s; their time windows are
 * DERIVED (never stored) by duration-chaining from `season.startedAt`.
 */
import type { SeasonEntry, PhaseSlice } from "../core/types.js";

/** Milliseconds in a day — the unit a phase's `days` count multiplies. */
export const DAY_MS = 86_400_000;

export interface PhaseWindow {
  slice: PhaseSlice;
  start: number;
  end: number;
}

/** Derived windows for a season's phases, chained from `startedAt`. Empty when the season declares none. */
export function derivePhaseWindows(season: SeasonEntry | null): PhaseWindow[] {
  const phases = season?.phases;
  if (season === null || phases === undefined || phases.length === 0) return [];

  const seasonEnd = season.endedAt ?? season.expectedEndAt;
  const windows: PhaseWindow[] = [];
  let cursor = season.startedAt;

  phases.forEach((slice, index) => {
    const isLast = index === phases.length - 1;
    const start = cursor;
    // The final slice (and any slice missing `days`) runs to the season's end;
    // a slice with `days` runs that many days from its start. Clamp to the
    // season end so an over-long chain truncates into zero-length trailing
    // windows rather than spilling past the season.
    const rawEnd = isLast || slice.days === undefined ? seasonEnd : start + slice.days * DAY_MS;
    const end = Math.min(rawEnd, seasonEnd);
    windows.push({ slice, start, end });
    cursor = end;
  });

  return windows;
}

/** The phase window whose half-open [start, end) window contains `now`, else null. */
export function selectActivePhaseWindow(
  season: SeasonEntry | null,
  now: number,
): PhaseWindow | null {
  if (season === null) return null;
  const seasonEnd = season.endedAt ?? season.expectedEndAt;
  if (now < season.startedAt || now >= seasonEnd) return null;

  for (const window of derivePhaseWindows(season)) {
    // Half-open: a boundary instant belongs to the LATER slice.
    if (now >= window.start && now < window.end) return window;
  }
  return null;
}

/** The slice whose half-open [start, end) window contains `now`, else null. */
export function selectActivePhase(season: SeasonEntry | null, now: number): PhaseSlice | null {
  return selectActivePhaseWindow(season, now)?.slice ?? null;
}

/** The slice with this slug, else null. Used by reveal to honour a question's stamp. */
export function findPhaseBySlug(
  season: SeasonEntry | null,
  slug: string | undefined,
): PhaseSlice | null {
  if (season === null || slug === undefined) return null;
  return season.phases?.find((phase) => phase.slug === slug) ?? null;
}
