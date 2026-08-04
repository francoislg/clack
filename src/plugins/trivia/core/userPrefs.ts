import { z } from "zod";

/** Per-user trivia preferences persisted in the user-preferences `plugins.trivia` slice. */
export const TRIVIA_USER_PREFS_SCHEMA = z.object({ revealReminders: z.boolean() });

export type TriviaUserPrefs = z.infer<typeof TRIVIA_USER_PREFS_SCHEMA>;
