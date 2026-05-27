import type { KnownBlock } from "@slack/types";
import type {
  SeasonFormat,
  TriviaAnswersFormatWeights,
  TriviaQuestionTypeWeights,
  TriviaFreeformAnswerShape,
  TriviaFreeformAnswerShapeWeights,
  TriviaContextEntry,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
  RevealResponsesMode,
} from "./configTypes.js";

/**
 * Answer-shape discriminator (renamed from `type`). Absent only on pre-migration legacy rows;
 * the v021 migration stamps every existing record. New writes always set it.
 * - `"boolean"` → carries `isTrue: boolean`, no `choices`/`correctIndex`.
 * - `"choice"` → carries `choices: string[]` + `correctIndex: number`, no `isTrue`.
 * - `"freeform"` → carries `expectedAnswer: string` and optional `acceptableAnswers[]`
 *   / `gradingNotes`; no `isTrue`/`choices`/`correctIndex`. Answers come through a
 *   modal (not Slack reactions) and are judged at reveal time by a small model.
 */
export type TriviaAnswersFormat = "boolean" | "choice" | "freeform";

/**
 * Source discriminator orthogonal to `answersFormat`.
 * - `"fact"` → static knowledge; no WebSearch.
 * - `"topical"` → recent newsworthy event; written after a `WebSearch` step.
 *   Topical records carry `sourceUrl` (required) and optionally `eventDate`.
 */
export type TriviaQuestionType = "fact" | "topical";

export interface TriviaQuestion {
  id: string;
  category: string;
  statement: string;
  /** Answer-shape discriminator. Absence reads as `"boolean"` for pre-migration legacy rows only. */
  answersFormat?: TriviaAnswersFormat;
  /** Fact-vs-topical discriminator. Absence reads as `"fact"` for pre-migration legacy rows only. */
  questionType?: TriviaQuestionType;
  /** Truth value for boolean questions. Absent on choice and freeform questions. */
  isTrue?: boolean;
  /** Option list for choice questions (2–4 entries). Absent on boolean and freeform questions. */
  choices?: string[];
  /** 0-based index of the correct choice. Absent on boolean and freeform questions. */
  correctIndex?: number;
  /**
   * Canonical expected answer for freeform questions — the shortest correct form
   * Claude would accept as a 100%-perfect answer. Required when
   * `answersFormat === "freeform"`; forbidden otherwise.
   */
  expectedAnswer?: string;
  /**
   * Optional pre-enumerated semantic variants Claude would also accept (e.g.
   * canonical-plus-common-forms). Freeform-only.
   */
  acceptableAnswers?: string[];
  /**
   * Optional hint to the reveal-time judge about acceptable answer forms or
   * specific judging considerations. Freeform-only.
   */
  gradingNotes?: string;
  /**
   * The rolled freeform answer shape passed through from `get_ideas`. Recorded
   * for post-hoc audit — lets us check whether Claude actually honored the
   * non-negotiable shape directive on each question. Freeform-only. Absent on
   * legacy rows and on rows written before the persistence was added.
   */
  freeformAnswerShape?: TriviaFreeformAnswerShape;
  /** Difficulty bucket targeted at generation time. Absent on legacy rows. */
  suggestedDifficulty?: "Easy" | "Medium" | "Hard";
  /** Claude's 1–10 self-rating from the difficulty gate. Absent on legacy rows. */
  difficulty?: number;
  emojis: string[];
  createdAt: number;
  postedAt?: number;
  messageLink?: string;
  /**
   * Block Kit blocks the question was posted with. Stamped by `post_questions`
   * so consumers that want to `chat.update` the card (e.g. the freeform
   * roster footer) have an immutable base to rebuild from. Edits compose
   * `[...postedBlocks, …new blocks]` rather than mutating this field, so each
   * edit starts fresh. Absent on legacy / pre-feature rows.
   */
  postedBlocks?: KnownBlock[];
  /**
   * Lens name that was used when generating this question. Recorded from
   * `contextPriority[i]` (the entry Claude actually used). Empty / no-lens
   * outcomes are stored as absence. Only meaningful when `trivia.contexts`
   * was configured at write time.
   */
  context?: string;
  /** Citation URL — REQUIRED on topical questions, forbidden on fact questions. */
  sourceUrl?: string;
  /** ISO 8601 date (YYYY-MM-DD) of the underlying event. Topical only. */
  eventDate?: string;
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
  /**
   * Resolved at `post_questions` time from the cascade
   * `slot → season → game → workspace → true`. Read by the live roster
   * rebuild (`editRosterIntoCard`) to decide whether to show each answerer's
   * pick alongside their name. Absent on legacy / pre-feature rows; absence
   * SHALL be read as `true` (the cascaded default).
   */
  liveAnswersVisible?: boolean;
  /**
   * Resolved at `post_questions` time from the cascade
   * `slot → season → game → workspace → "yes"`. Read by `process_reveal_answers`
   * when assembling the per-reveal payload's `voters` field. Absent on legacy
   * / pre-feature rows; absence SHALL be read as `"yes"`.
   */
  revealResponses?: RevealResponsesMode;
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
  /** Set for answers to boolean questions. Mutually exclusive with `answerIndex` / `answerText`. */
  answer?: boolean;
  /** Set for answers to choice questions (0-based reaction index). Mutually exclusive with `answer` / `answerText`. */
  answerIndex?: number;
  /**
   * Set for answers to freeform questions — the user's typed text from the modal.
   * Mutually exclusive with `answer` / `answerIndex`.
   */
  answerText?: string;
  /**
   * Correctness verdict.
   * - `true` / `false` → scored row, contributes to leaderboard counts.
   * - `undefined` → pending freeform submission awaiting reveal-time validation.
   *   Aggregators (computeLeaderboard, getQuestionHistory schema, stat counts)
   *   SHALL exclude these rows entirely until the reveal flips them.
   * Boolean and choice answers always have a synchronously-computed boolean here.
   */
  correct?: boolean;
  /**
   * Optional short label explaining the verdict for freeform submissions —
   * echoed from the reveal-time judge (e.g. "multiple-guess", "too-broad",
   * "typo-too-far", "out-of-tolerance", "judge-error"). Absent on boolean/choice
   * rows and on freeform rows where the judge returned no reason.
   */
  judgeReason?: string;
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

export interface SeasonEntry {
  slug: string;
  startedAt: number;
  expectedEndAt: number;
  endedAt?: number;
  /**
   * Optional short human-readable narrative label (e.g. "Halloween Spooktacular").
   * Surfaced by `get_ideas` and the first-fire opener in the question-posting prompt.
   * Never inferred from other fields; admins set it explicitly via `upsert_season`.
   */
  theme?: string;
  categories: string[];
  /**
   * Optional per-season answer-format weights. Absent → `get_ideas` falls back to
   * `config.trivia.answersFormat`. Mid-season mutation is permitted (unlike `startedAt`).
   */
  answersFormat?: TriviaAnswersFormatWeights;
  /**
   * Optional per-season fact-vs-topical weights. Absent → falls back to `config.trivia.questionType`.
   * Mid-season mutation is permitted.
   */
  questionType?: TriviaQuestionTypeWeights;
  /**
   * Optional per-season freeform answer-shape weights. Absent → falls back to `config.trivia.freeformAnswerShape`.
   * Freeform-branch only; ignored by boolean/choice. Mid-season mutation is permitted.
   */
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  /**
   * Optional per-season lens list. Absent → falls back to `config.trivia.contexts`
   * (which itself may be absent). Mid-season mutation is permitted.
   */
  contexts?: TriviaContextEntry[];
  /**
   * Optional per-season per-game-type difficulty overrides. Each game type
   * (boolean/choice/freeform) is independently overridable; within each game type,
   * easy/medium/hard cascade independently (per-field merge). Absent → falls back
   * to `config.trivia.difficulty` → `DEFAULT_DIFFICULTY_RANGES[format]`. Mid-season
   * mutation is permitted.
   */
  difficulty?: TriviaDifficultyConfig;
  /**
   * Optional per-season bucket-roll ratio. Whole-object replace per cascade tier
   * (slot → season → game → workspace → `DEFAULT_DIFFICULTY_RATIO[format]`) — the
   * season either provides a full `{ easy, medium, hard }` weight map for the format,
   * or cascades through. Mid-season mutation is permitted.
   */
  difficultyRatio?: TriviaDifficultyRatioConfig;
  /**
   * Optional per-season question composition. Mid-season mutation is permitted —
   * changes take effect on the next question-cron fire.
   */
  format?: SeasonFormat;
  /**
   * Per-season tier of the live-roster-footer visibility axis. Cascade:
   *   `slot → season → game → workspace → true`.
   */
  liveAnswersVisible?: boolean;
  /**
   * Per-season tier of the reveal-time participation disclosure axis. Cascade:
   *   `slot → season → game → workspace → "yes"`.
   */
  revealResponses?: RevealResponsesMode;
  /**
   * Per-season tier of the replace-cascade `instructions` axis — see the
   * `trivia-prompt-instructions` capability. Mid-season mutation is permitted.
   */
  instructions?: string;
  /**
   * Per-season tier of the cumulative-cascade `additionalInstructions` axis —
   * see the `trivia-prompt-instructions` capability. Mid-season mutation is permitted.
   */
  additionalInstructions?: string;
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
   * Merge `partial` into the existing row matched by `(userId, questionId)`. Used
   * to flip `correct` from `undefined` to the judged verdict on freeform answers
   * at reveal time, and to update `answerText` on modal edits. No-op (logged
   * warn) when no row matches.
   */
  updateAnswer(
    userId: string,
    questionId: string,
    partial: Partial<SubmittedAnswer>,
  ): Promise<void>;
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
