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
  season?: string;
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
