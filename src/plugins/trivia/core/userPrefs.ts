import { z } from "zod";

/**
 * Per-user trivia preferences persisted in the user-preferences `plugins.trivia` slice.
 * Reveal reminders are opt-in PER GAME: the slice is a map from a per-game reminder key
 * (see {@link revealReminderKey}) to a boolean. A missing/false entry means "no reminder
 * for that game". Permissive record shape — unknown game keys are tolerated, so a slice
 * survives games being added or removed from config.
 */
export const TRIVIA_USER_PREFS_SCHEMA = z.record(z.string(), z.boolean());

export type TriviaUserPrefs = z.infer<typeof TRIVIA_USER_PREFS_SCHEMA>;

/** Preference-slice key for a game's reveal-reminder opt-in. Stable across renders/fires. */
export function revealReminderKey(game: string): string {
  return `game:${game}`;
}

/** Human-friendly label for a game slug (e.g. `daily-trivia` → `Daily Trivia`). */
export function prettifyGameName(game: string): string {
  return game
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
