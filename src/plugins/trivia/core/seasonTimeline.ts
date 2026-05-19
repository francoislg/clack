import type { SeasonsState, SeasonEntry } from "./types.js";

/**
 * Returns the season whose active window contains `now`, or null when `now` falls
 * in a gap between seasons (or there is no current state at all).
 *
 * The active window is `[startedAt, endedAt ?? expectedEndAt)`. The no-overlap
 * invariant enforced by upsert_season guarantees at most one season satisfies the
 * predicate; if more than one does, the timeline has been corrupted and we throw.
 */
export function findCurrentSeason(state: SeasonsState | null, now: number): SeasonEntry | null {
  if (state === null) return null;
  const active = state.seasons.filter(
    (s) => s.startedAt <= now && (s.endedAt ?? s.expectedEndAt) > now,
  );
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  throw new Error(
    `Timeline invariant violated: ${active.length} seasons active at ${new Date(now).toISOString()}`,
  );
}

/**
 * Returns the next future season — the entry with the smallest `startedAt` strictly
 * greater than `now`, or null if none exist.
 */
export function findNextSeason(state: SeasonsState | null, now: number): SeasonEntry | null {
  if (state === null) return null;
  const future = state.seasons.filter((s) => s.startedAt > now);
  if (future.length === 0) return null;
  return future.reduce((earliest, s) => (s.startedAt < earliest.startedAt ? s : earliest));
}

/** Returns the season whose slug matches, or null. */
export function findSeasonBySlug(state: SeasonsState | null, slug: string): SeasonEntry | null {
  if (state === null) return null;
  return state.seasons.find((s) => s.slug === slug) ?? null;
}

/**
 * Two intervals `[aStart, aEnd)` and `[bStart, bEnd)` overlap iff aStart < bEnd && bStart < aEnd.
 * For seasons, the "end" of the interval is `endedAt ?? expectedEndAt`.
 */
function intervalsOverlap(a: SeasonEntry, b: SeasonEntry): boolean {
  const aEnd = a.endedAt ?? a.expectedEndAt;
  const bEnd = b.endedAt ?? b.expectedEndAt;
  return a.startedAt < bEnd && b.startedAt < aEnd;
}

/**
 * Throws if `proposed` would overlap any other season on the timeline.
 * `excludingSlug` is excluded from the overlap check — used when upserting an existing entry.
 */
export function validateNoOverlap(
  state: SeasonsState | null,
  proposed: SeasonEntry,
  excludingSlug?: string,
): void {
  if (state === null) return;
  for (const existing of state.seasons) {
    if (excludingSlug !== undefined && existing.slug === excludingSlug) continue;
    if (intervalsOverlap(proposed, existing)) {
      throw new Error(
        `Season "${proposed.slug}" interval [${proposed.startedAt}, ${proposed.endedAt ?? proposed.expectedEndAt}) overlaps existing season "${existing.slug}" [${existing.startedAt}, ${existing.endedAt ?? existing.expectedEndAt})`,
      );
    }
  }
}
