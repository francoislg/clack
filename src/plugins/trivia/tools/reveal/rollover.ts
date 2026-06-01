import { triviaLogger as logger } from "../../core/pluginLogger.js";
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
 *      continuation season inherits `answersFormat`, `questionType`, `contexts`,
 *      and `format` from the closing season (deep copies of each field; absent
 *      fields stay absent). It does NOT inherit the closing season's
 *      season-level `categories` — that field is omitted so the pool resolves
 *      via the cascade (`game.categories → global categories.json`). A themed
 *      season is a temporary, one-month deviation; absent an explicitly staged
 *      future season, the continuation reverts to the baseline rather than
 *      silently re-baking the theme forward. Slot-level
 *      `format.questions[i].categories` IS preserved (it travels with the
 *      deep-copied `format` as structural slot composition, not a theme).
 *      Admins stage a future season explicitly to carry a theme forward.
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
      // Season-level `categories` is intentionally NOT carried forward: a themed
      // season is a one-month deviation, so the continuation omits the field and
      // lets the pool resolve via the cascade (game.categories → global). Slot-
      // level `format.questions[i].categories` is still preserved below.
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
