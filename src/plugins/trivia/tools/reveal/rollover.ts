import { logger } from "../../../../logger.js";
import { findNextSeason, validateNoOverlap } from "../../core/seasonTimeline.js";
import type { LeaderboardEntry } from "../../domain/computeLeaderboard.js";
import type { SeasonsState, SeasonEntry } from "../../core/types.js";
import type { SeasonStatusOut } from "./types.js";

/**
 * Pick the season MVP — the player with the highest `currentSeasonCorrect` count
 * from the supplied leaderboard. Ties broken by `totalCorrect`. Returns undefined
 * when no leaderboard entry has positive current-season participation.
 */
export function pickSeasonMvp(leaderboard: LeaderboardEntry[]): SeasonStatusOut["mvp"] | undefined {
  let best: LeaderboardEntry | undefined;
  for (const entry of leaderboard) {
    const cs = entry.currentSeasonCorrect ?? 0;
    if (cs <= 0) continue;
    if (best === undefined) {
      best = entry;
      continue;
    }
    const bestCs = best.currentSeasonCorrect ?? 0;
    if (cs > bestCs || (cs === bestCs && entry.totalCorrect > best.totalCorrect)) {
      best = entry;
    }
  }
  if (best === undefined) return undefined;
  return {
    userId: best.userId,
    displayName: best.displayName,
    currentSeasonCorrect: best.currentSeasonCorrect ?? 0,
  };
}

/**
 * Derive the next season's slug (`season-YYYY-MM`) for the calendar month after
 * `after`, plus the end-of-that-month UTC timestamp.
 */
export function deriveNextMonthSlug(after: number): { slug: string; expectedEndAt: number } {
  const d = new Date(after);
  const nextMonthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  const start = new Date(nextMonthStart);
  const yyyy = start.getUTCFullYear();
  const mm = String(start.getUTCMonth() + 1).padStart(2, "0");
  const slug = `season-${yyyy}-${mm}`;
  const expectedEndAt = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  return { slug, expectedEndAt };
}

export interface RolloverOutcome {
  seasonClosed: boolean;
  newSeasonStarted?: { slug: string; expectedEndAt: number };
  /** Mutated state — caller persists when `seasonClosed || newSeasonStarted` is true. */
  state: SeasonsState;
}

/**
 * Apply the season-end rollover to a `SeasonsState` IN PLACE:
 *   1. Stamp `endedAt` on the closing season (idempotent — skips when already set).
 *   2. If no future season is queued (no entry with `startedAt > now`), append a
 *      continuation season with a `season-YYYY-MM` slug for next month. The
 *      continuation season inherits `categories`, `questionTypes`, and `format`
 *      from the closing season (deep copies of each field; absent fields stay
 *      absent). This is the "repeat" semantic — admins stage a future season
 *      explicitly when they want to break the inheritance chain.
 *
 * Returns the outcome flags so the caller can populate `seasonStatus` AND decide
 * whether to persist the mutated state.
 */
export function applySeasonRollover(
  state: SeasonsState,
  currentSlug: string,
  now: number,
): RolloverOutcome {
  let seasonClosed = false;
  let newSeasonStarted: RolloverOutcome["newSeasonStarted"];

  const idx = state.seasons.findIndex((s) => s.slug === currentSlug);
  const closingSnapshot: SeasonEntry | null = idx !== -1 ? { ...state.seasons[idx] } : null;
  if (idx !== -1 && state.seasons[idx].endedAt === undefined) {
    state.seasons[idx] = { ...state.seasons[idx], endedAt: now };
    seasonClosed = true;
  }

  const next = findNextSeason(state, now);
  if (next === null && closingSnapshot !== null) {
    const { slug, expectedEndAt } = deriveNextMonthSlug(now);
    const fresh: SeasonEntry = {
      slug,
      startedAt: now,
      expectedEndAt,
      ...(closingSnapshot.categories !== undefined
        ? { categories: [...closingSnapshot.categories] }
        : {}),
      ...(closingSnapshot.answersFormat !== undefined
        ? { answersFormat: { ...closingSnapshot.answersFormat } }
        : {}),
      ...(closingSnapshot.questionType !== undefined
        ? { questionType: { ...closingSnapshot.questionType } }
        : {}),
      ...(closingSnapshot.contexts !== undefined
        ? { contexts: closingSnapshot.contexts.map((c) => ({ ...c })) }
        : {}),
      ...(closingSnapshot.format !== undefined
        ? {
            format: {
              questions: closingSnapshot.format.questions.map((slot) => ({
                ...(slot.label !== undefined ? { label: slot.label } : {}),
                ...(slot.categories !== undefined ? { categories: [...slot.categories] } : {}),
                ...(slot.answersFormat !== undefined
                  ? { answersFormat: { ...slot.answersFormat } }
                  : {}),
                ...(slot.questionType !== undefined
                  ? { questionType: { ...slot.questionType } }
                  : {}),
                ...(slot.contexts !== undefined
                  ? { contexts: slot.contexts.map((c) => ({ ...c })) }
                  : {}),
              })),
            },
          }
        : {}),
    };
    try {
      validateNoOverlap(state, fresh);
      state.seasons.push(fresh);
      newSeasonStarted = { slug, expectedEndAt };
    } catch (err) {
      logger.warn(
        `applySeasonRollover: failed to create continuation season "${slug}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { seasonClosed, newSeasonStarted, state };
}
