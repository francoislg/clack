/**
 * Question shape discriminator. Absent on legacy rows; new writes always stamp it.
 * - `"boolean"` → carries `isTrue: boolean`, no `choices`/`correctIndex`.
 * - `"choice"` → carries `choices: string[]` + `correctIndex: number`, no `isTrue`.
 */
export type TriviaQuestionType = "boolean" | "choice";

export interface TriviaQuestion {
  id: string;
  category: string;
  statement: string;
  /** Discriminator. Absence reads as `"boolean"` for legacy rows. */
  type?: TriviaQuestionType;
  /** Truth value for boolean questions. Absent on choice questions. */
  isTrue?: boolean;
  /** Option list for choice questions (2–4 entries). Absent on boolean questions. */
  choices?: string[];
  /** 0-based index of the correct choice. Absent on boolean questions. */
  correctIndex?: number;
  /** Difficulty bucket targeted at generation time. Absent on legacy rows. */
  suggestedDifficulty?: "Easy" | "Medium" | "Hard";
  /** Claude's 1–10 self-rating from the difficulty gate. Absent on legacy rows. */
  difficulty?: number;
  emojis: string[];
  createdAt: number;
  postedAt?: number;
  messageLink?: string;
  /**
   * UUID stamped by `post_questions` per call. Every fresh item posted in one call shares the
   * same value; idempotency-skipped items keep their original value (which may be undefined on
   * legacy rows). `process_reveal_answers` groups pending questions by this field to reveal one
   * batch per fire.
   */
  batchId?: string;
  /**
   * Stamped by `process_reveal_answers` when the question's reveal has run. Absence means
   * pending. Legacy rows are treated as pending until either back-filled or written.
   */
  processedAt?: number;
  season?: string;
  /**
   * Stamped at write time when the active season has a `format`. `label` is
   * snapshotted from `format.questions[index].label` at write time (denormalized
   * the same way `season` is, so the record's meaning survives format edits).
   */
  slot?: { index: number; label?: string };
}

// `cheatAttempts` is cumulative across seasons — season rollover does not reset it.
export interface TriviaUser {
  userId: string;
  displayName: string;
  joinedAt: number;
  cheatAttempts?: number;
}

export interface SubmittedAnswer {
  userId: string;
  questionId: string;
  /** Set for answers to boolean questions. Mutually exclusive with `answerIndex`. */
  answer?: boolean;
  /** Set for answers to choice questions (0-based reaction index). Mutually exclusive with `answer`. */
  answerIndex?: number;
  correct: boolean;
  timestamp: number;
  season?: string;
}

export interface CheatReport {
  cheaterUserId: string;
  questionId: string;
  reason: string;
  evidence?: string;
  detectedAt: string;
  season?: string;
}

export interface TriviaSeasonsConfig {
  enabled: boolean;
  prompt: string;
}

/**
 * Per-season question-type weights. Mirrors `config.trivia.questionsTypes` in shape.
 * When set on a SeasonEntry, overrides the workspace-level config for the window
 * during which this entry is current per `findCurrentSeason(state, now)`.
 */
export type SeasonQuestionTypeWeights = Record<"boolean" | "choice", number>;

/**
 * One ordered slot in a season's question format. Optional per-slot overrides:
 *
 * - `label` — creative hint fed to Claude at posting time (e.g. "Lightning Round").
 *   Not a literal string to copy into question text.
 * - `categories` — narrows the slot's category pool. Falls back to the season's
 *   `categories` when absent.
 * - `questionTypes` — slot-specific weights. Falls back to season → config → default
 *   when absent.
 */
export interface SeasonFormatSlot {
  label?: string;
  categories?: string[];
  questionTypes?: SeasonQuestionTypeWeights;
}

/**
 * Optional per-season question composition. When present, each question-cron fire
 * posts `questions.length` questions (one per slot, in array order). When absent,
 * the season posts a single question per fire (pre-format behavior).
 */
export interface SeasonFormat {
  questions: SeasonFormatSlot[];
}

export interface SeasonEntry {
  slug: string;
  startedAt: number;
  expectedEndAt: number;
  endedAt?: number;
  categories: string[];
  /**
   * Optional per-season question-type weights. Absent → `get_ideas` falls back to
   * `config.trivia.questionsTypes`. Mid-season mutation is permitted (unlike `startedAt`).
   */
  questionTypes?: SeasonQuestionTypeWeights;
  /**
   * Optional per-season question composition. Mid-season mutation is permitted —
   * changes take effect on the next question-cron fire.
   */
  format?: SeasonFormat;
}

export interface SeasonsState {
  seasons: SeasonEntry[];
}

/**
 * Per-game data accessor — every method reads/writes inside `games/<name>/`.
 * Obtained via `TriviaDataLayer.forGame(name)`.
 *
 * `saveCheat` is the one exception: it writes the cheat report into the named
 * game's `cheats.json` but increments the cumulative `cheatAttempts` counter on
 * the global `users.json`. The closure composes both writes for the caller.
 */
export interface ScopedTriviaDataLayer {
  loadQuestions(): Promise<TriviaQuestion[]>;
  saveQuestion(q: TriviaQuestion): Promise<void>;
  updateQuestion(id: string, updates: Partial<TriviaQuestion>): Promise<void>;
  loadAnswers(): Promise<SubmittedAnswer[]>;
  saveAnswer(a: SubmittedAnswer): Promise<void>;
  /**
   * Hard-delete every `SubmittedAnswer` for the named questionId. Returns the count removed.
   * Used by `process_reveal_answers` when reprocessing — the canonical source of truth is the
   * current Slack reactions, so prior rows are dropped before re-derivation.
   */
  deleteAnswersForQuestion(questionId: string): Promise<number>;
  loadCheats(): Promise<CheatReport[]>;
  saveCheat(report: CheatReport): Promise<{ totalAttempts: number }>;
  loadSeasonsState(): Promise<SeasonsState | null>;
  saveSeasonsState(state: SeasonsState): Promise<void>;
  getCurrentSeasonSlug(): Promise<string | null>;
}

export interface TriviaDataLayer {
  /** Global — shared across all games. */
  loadCategories(): Promise<string[]>;
  saveCategories(categories: string[]): Promise<void>;
  /** Global — shared across all games (incl. cumulative `cheatAttempts`). */
  loadUsers(): Promise<Map<string, TriviaUser>>;
  saveUser(u: TriviaUser): Promise<void>;
  /** Per-game data accessor — every read/write is scoped to `games/<name>/`. */
  forGame(name: string): ScopedTriviaDataLayer;
}
