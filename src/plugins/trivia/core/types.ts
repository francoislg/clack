import type { KnownBlock } from "@slack/types";
import type {
  SeasonFormat,
  SeasonFormatSlot,
  TriviaFreeformAnswerShape,
  JudgeLeniency,
  RevealResponsesMode,
} from "./configTypes.js";
// SeasonEntry extends CascadeAxes (the per-season tier of every cascading axis).
// Type-only circular import with cascadeAxes.ts — no runtime cycle.
import type { CascadeAxes } from "./cascadeAxes.js";

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
 * - `"prediction"` → UPCOMING event whose outcome is unknown at write time. Written
 *   after a `WebSearch` step (carries `sourceUrl`), saved with NO answer key and
 *   `resolved: false`. The key is stamped later by `settle_question` at reveal time.
 *   Restricted to `boolean`/`choice` answer formats (never `freeform`).
 */
export type TriviaQuestionType = "fact" | "topical" | "prediction";

/**
 * Prompt-delivery medium, orthogonal to `answersFormat` and `questionType`.
 * - `"text"` → the prompt is delivered as text (today's behavior).
 * - `"image"` → the prompt is an image; the record carries a `media` object whose
 *   `url` is rendered in the message's `image` block. Sourced from an external
 *   image-search MCP tool (see the trivia-visual-questions capability).
 *
 * Absence reads as `"text"` everywhere — legacy and text-medium rows omit the field.
 */
export type TriviaPromptMedium = "text" | "image";

/**
 * Image payload attached to an image-medium question. Present iff
 * `promptMedium === "image"`; forbidden otherwise. `url` is the upstream public
 * HTTPS source used as the `image_url` of the message's Block Kit `image` block;
 * `subjectId` is the source-namespaced dedup key (e.g. `wikidata:Q243`,
 * `commons:File:...`, `brave:<hash>`).
 */
export interface QuestionMedia {
  kind: "image";
  url: string;
  altText: string;
  subjectId: string;
  title: string;
  license?: string;
  attribution?: string;
}

export interface TriviaQuestion {
  id: string;
  category: string;
  statement: string;
  /** Answer-shape discriminator. Absence reads as `"boolean"` for pre-migration legacy rows only. */
  answersFormat?: TriviaAnswersFormat;
  /** Fact-vs-topical discriminator. Absence reads as `"fact"` for pre-migration legacy rows only. */
  questionType?: TriviaQuestionType;
  /**
   * Prompt-delivery medium. Absence reads as `"text"` (legacy and text-medium rows
   * omit it). When `"image"`, `media` MUST be present.
   */
  promptMedium?: TriviaPromptMedium;
  /** Image payload for image-medium questions. Present iff `promptMedium === "image"`. */
  media?: QuestionMedia;
  /** Truth value for boolean questions. Absent on choice and freeform questions. */
  isTrue?: boolean;
  /** Option list for choice questions (2–4 entries). Absent on boolean and freeform questions. */
  choices?: string[];
  /** 0-based index of the correct choice. Absent on boolean and freeform questions. */
  correctIndex?: number;
  /**
   * Per-option Unicode emoji prefixes for choice questions, parallel to `choices`.
   * Stamped by `save_question` when the cascade-resolved `choiceEmojiStyle` is
   * `"themed"` and Claude supplied them, so vote buttons and the live roster keep
   * the emojis the question was posed with even if config later changes. Purely
   * cosmetic — the vote is the button's index. Absence reads as numbered prefixes.
   */
  choiceEmojis?: string[];
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
   * Claude-authored reveal NARRATIVE blocks (the WHY / fun-fact / "nobody
   * cracked it" teaching) for this question's card. Persisted by `set_reveal_narrative`
   * and appended below the deterministic results footer by `refresh_question_cards`
   * when `includeRevealInQuestions` resolves to `"yes"`. NEVER the deterministic
   * Answer/Correct/Incorrect facts (those always render from `answers.json`).
   * Absent in `"no"` mode and on all legacy rows.
   */
  revealBlocks?: KnownBlock[];
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
  /**
   * Resolved at `post_questions` time from the cascade `game → workspace → true`.
   * Read by the live roster rebuild (`editRosterIntoCard`) and the reveal-time
   * card footer (`editRevealIntoCard`) to decide whether to name answerers with
   * pinging `<@USERID>` mentions (`true`) or plain `@displayName` (`false`).
   * Absent on legacy / pre-feature rows; absence SHALL be read as `true`.
   */
  tagPlayers?: boolean;
  /**
   * Voting-frozen flag. Set to `true` by `lock_questions` (fired by a game's optional
   * `lockCron`) and cleared by the admin `unlock_questions` tool. The live-card rebuild
   * (`editRosterIntoCard`) reads it: when `true` it strips the answer-actions block and
   * shows a "locked in — waiting on results" notice instead of the buttons + roster.
   * The vote/freeform click handlers also reject answers while it is `true`. Absent on
   * legacy / pre-feature rows; absence SHALL be read as unlocked.
   */
  answerLocked?: boolean;
  /**
   * Optional hint attached to the question. Written by `save_question` when
   * Claude generates one (driven by `get_ideas` payload's `suggestedHintMode`),
   * read by `post_questions` to render the hint button / inline block. `mode`
   * `"none"` is unrepresentable on the record (= absent field). `clickedBy` is
   * populated by the hint-button action handler (button mode only) and is
   * absent until the first click. Strictly internal — NEVER surfaced at
   * reveal time, NEVER affects scoring.
   */
  hint?: {
    mode: "button" | "inline";
    text: string;
    clickedBy?: string[];
  };
  /**
   * Reveal-judge leniency preset, resolved from the cascade
   * `slot → season → game → workspace → "strict-with-typos"` and stamped by
   * `save_question` at generation time so a mid-cycle config change does not
   * retroactively re-judge already-posed questions. Read by the freeform reveal
   * judge to select its matching-forgiveness fragments. Absent on legacy /
   * non-freeform rows; absence SHALL be read as `"strict-with-typos"`.
   */
  judgeLeniency?: JudgeLeniency;
  /**
   * Prediction lifecycle flag. Present (and `false`) only on `questionType: "prediction"`
   * records, which are saved without an answer key (`isTrue` / `correctIndex`). Flipped to
   * `true` by `settle_question` once the real-world outcome is known. Absence reads as a
   * normal answered question (legacy and non-prediction rows carry their key from save time
   * and omit this field) — readers MUST NOT treat an absent `resolved` as pending.
   */
  resolved?: boolean;
  /**
   * The settled outcome stamped by `settle_question` alongside the answer key — boolean for
   * boolean predictions, the winning option text for choice predictions. Audit-only; scoring
   * reads the stamped key (`isTrue` / `correctIndex`). Absent on voided records.
   */
  resolvedOutcome?: boolean | string;
  /** Epoch millis when `settle_question` decided the question (answered or invalidated). */
  resolvedAt?: number;
  /**
   * General INVALIDATED flag (any format / any questionType). An invalidated question is worth
   * 0 points, is never scored, and renders as "invalidated / no result" at reveal. Invalidating
   * a pending prediction also sets `resolved: true` (it counts as a decision for the reveal
   * gate). Absent everywhere else.
   */
  invalidated?: boolean;
  /**
   * Human-readable reason a question was invalidated (e.g. "match postponed"). Present iff
   * `invalidated`.
   */
  invalidatedReason?: string;
}

/** Plugin-facing identity, sourced from the central user registry via `sdk.users`. */
export interface TriviaUser {
  userId: string;
  displayName: string;
}

/**
 * Trivia's per-user namespace slice in the central registry (`plugins.trivia`). `joinedAt`
 * is the first-answer timestamp; `cheatAttempts` is the cumulative cheat tally (never reset
 * on season rollover).
 */
export interface TriviaUserData {
  joinedAt?: number;
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
   * "typo-too-far", "out-of-tolerance", "materially-different"). Absent on
   * boolean/choice rows and on freeform rows where the judge returned no reason.
   */
  judgeReason?: string;
  /**
   * The machine verdict captured the first time an admin overrode this row via
   * `override_answer` — captured once so subsequent overrides never lose the
   * original (enables `restore`). Its PRESENCE is the reprocess lock: a row with
   * `originalVerdict` set is skipped by reveal re-derivation but still projected
   * with its stored verdict. Absent = machine-judged.
   */
  originalVerdict?: { correct: boolean; judgeReason?: string };
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

export interface SeasonEntry extends CascadeAxes {
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
  /**
   * Optional season-tier category pool. Absent → cascade falls through to
   * `game.categories → globalCategories` (see `resolveActiveCategories` in
   * `../domain/categories.ts`). When present, MUST be non-empty (deduped) —
   * empty arrays on disk are not allowed; readers SHALL treat the field as
   * absent if and only if the JSON key is missing.
   */
  categories?: string[];
  /**
   * Optional per-season question composition. Mid-season mutation is permitted —
   * changes take effect on the next question-cron fire. Mutually exclusive with
   * `slotOverrides` (enforced at parse time): a season either declares its own
   * structure (`format`, which changes the question count) OR layers sparse,
   * count-decoupled per-slot overrides (`slotOverrides`), not both.
   */
  format?: SeasonFormat;
  /**
   * Optional sparse per-slot overrides keyed by game-format slot index. Each value
   * is a partial bag of cascade axes that overrides `game.format.questions[index]`
   * field-by-field (the `seasonSlot` tier). Count-decoupled — never changes how many
   * questions a fire posts. Mutually exclusive with `format`.
   */
  slotOverrides?: Record<number, SeasonFormatSlot>;
  // The per-season tier of every cascading axis (answersFormat, questionType,
  // promptMedium, freeformAnswerShape, contexts, difficulty, difficultyRatio,
  // instructions, additionalInstructions, liveAnswersVisible, revealResponses, hint,
  // judgeLeniency) is inherited from CascadeAxes — the single source of truth.
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
  loadCheats(): Promise<CheatReport[]>;
  saveCheat(report: CheatReport): Promise<{ totalAttempts: number }>;
  /**
   * Inverse of `saveCheat`: drop every cheat report matching `(cheaterUserId,
   * questionId)` and decrement the global `cheatAttempts` counter by the number
   * removed (floored at 0). A no-match call writes nothing.
   */
  removeCheat(
    cheaterUserId: string,
    questionId: string,
  ): Promise<{ removedCount: number; totalAttempts: number }>;
  loadSeasonsState(): Promise<SeasonsState | null>;
  saveSeasonsState(state: SeasonsState): Promise<void>;
  getCurrentSeasonSlug(): Promise<string | null>;
}

export interface TriviaDataLayer {
  /** Global — shared across all games. */
  loadCategories(): Promise<string[]>;
  saveCategories(categories: string[]): Promise<void>;
  /** Global identity lookup, sourced from the central user registry (`sdk.users.list`). */
  loadUsers(): Promise<Map<string, TriviaUser>>;
  /**
   * Warm/refresh identities for `userIds` through the registry (`sdk.users.get`), so a
   * subsequent `loadUsers` reflects current display names. Used at reveal time and on first
   * answer. The registry handles TTL-gated refresh and Slack-fetch failures internally.
   */
  refreshIdentities(userIds: readonly string[]): Promise<void>;
  /**
   * Record the first-answer join time in trivia's user namespace — only-if-absent, so a
   * re-answer never overwrites the original join time.
   */
  recordJoin(userId: string): Promise<void>;
  /** Per-game data accessor — every read/write is scoped to `games/<name>/`. */
  forGame(name: string): ScopedTriviaDataLayer;
}
