/**
 * Shape registry for the three trivia answer formats (boolean / choice /
 * freeform). Each format gets one handler implementation; the rest of the
 * plugin code dispatches on `getAnswerTypeHandler(question.answersFormat)`
 * instead of branching on format strings in every consumer.
 *
 * The interface is split into two parts:
 *
 *  - `AnswerTypeHandler` — the always-implemented core: rendering, roster,
 *    reveal, plus the lifecycle hooks (`validateSaveArgs`, `buildQuestionRecord`,
 *    `rollGenerationSuggestions`, `buildHistoryResult`, `registerInteractions`).
 *  - `ClickableAnswerHandler` — extends the core with synchronous click
 *    scoring (`resolveClick`, `toAnswerPatch`). Implemented by `boolean` and
 *    `choice`; freeform's modal-based flow doesn't fit a sync click path.
 *
 * Callers that need to score a vote button click ask the registry for the
 * clickable narrowing; callers that just need to render buttons or compose
 * the roster footer can work off the base shape.
 */

import type { SlackBlocks } from "../../../slack/blocks.js";
import type { ClackSdk } from "../../sdk.js";
import type { JsonValue, JudgeLeniency, TriviaConfig } from "../core/configTypes.js";
import type { CascadeContext } from "../core/cascadeAxes.js";
import type {
  ScopedTriviaDataLayer,
  SubmittedAnswer,
  TriviaDataLayer,
  TriviaQuestion,
  TriviaUser,
} from "../core/types.js";
import type { ProcessRevealEntry, SlackReactionLike } from "../tools/reveal/types.js";
import type { SaveQuestionArgs } from "./saveSchema.js";

export type { SaveQuestionArgs } from "./saveSchema.js";

/**
 * The descriptive answer payload for one reveal entry. Each format's handler
 * emits its own variant from the question record; the reveal flow doesn't
 * need to know how to assemble these.
 */
export type RevealAnswerDescriptor =
  | { type: "boolean"; isTrue: boolean }
  | { type: "choice"; choices: string[]; correctIndex: number }
  | {
      type: "freeform";
      expectedAnswer: string;
      acceptableAnswers?: string[];
      gradingNotes?: string;
    };

/**
 * Read-only dependencies for `projectReveal` — assembling a question's voter
 * buckets from its ALREADY-SCORED answers, with NO writes (no judging, no
 * `processedAt` stamp, no row deletion). Boolean/choice use `fetchMessageReactions`
 * + `botUserId` for the commentary list and cheater exclusion; freeform uses only
 * `scoped` + `users`. The absence of `askClaude`/`now`/`isReprocessMode` makes the
 * no-write guarantee type-enforced.
 */
export interface ProjectRevealDeps {
  scoped: ScopedTriviaDataLayer;
  users: Map<string, TriviaUser>;
  botUserId: string;
  /** Slack message reactions fetcher; takes (channel, ts), returns normalized reactions. */
  fetchMessageReactions: (channel: string, ts: string) => Promise<SlackReactionLike[]>;
}

/**
 * Per-call dependencies the reveal flow injects when it asks a handler to
 * SCORE one question. Extends the read-only `ProjectRevealDeps` with the
 * write-side seams (freeform uses `askClaude` for the judge; all formats stamp
 * `processedAt` from `now`; `isReprocessMode` drives the verdict re-derivation branch).
 */
export interface ProcessRevealDeps extends ProjectRevealDeps {
  data: TriviaDataLayer;
  askClaude: ClackSdk["askClaude"];
  now: number;
  isReprocessMode: boolean;
}

/**
 * Per-question result from `processReveal`. Handlers report errors via the
 * `error` variant rather than throwing — the reveal flow accumulates them
 * into a per-id errors list and continues with the rest of the batch.
 */
export type ProcessRevealOutcome =
  | { ok: true; entry: ProcessRevealEntry }
  | { ok: false; error: string };

/**
 * Output of `resolveClick`: an opaque parsed click value carrying the
 * synchronously-computed correctness verdict. The internal `payload` shape
 * is INTENTIONALLY private — callers thread the whole `ResolvedClick` into
 * `handler.toAnswerPatch(resolved)` rather than destructuring it. This keeps
 * a future fifth format from forcing every caller to learn its payload
 * variant.
 */
export interface ResolvedClick {
  /**
   * Format-private — DO NOT destructure outside the handler. Callers go
   * through `handler.toAnswerPatch(resolved)` to get the merge-into-row patch.
   */
  payload: ClickPayload;
  correct: boolean;
}

/**
 * Internal — used only inside the handler implementations. The vote-handler
 * flow doesn't pattern-match on this; it threads `ResolvedClick` back into
 * `handler.toAnswerPatch(...)`.
 */
type ClickPayload = { answer: boolean } | { answerIndex: number };

/**
 * The base record fields the save-question tool composes before handing off
 * to the per-format `buildQuestionRecord`. The handler attaches the
 * format-specific fields (isTrue / choices+correctIndex / expectedAnswer+...)
 * to produce the final `TriviaQuestion`.
 *
 * `answersFormat` and `questionType` are present here because both are
 * cross-format axes the tool stamps unconditionally — the handler doesn't
 * decide them, it just inherits them.
 */
export type TriviaQuestionBase = Omit<
  TriviaQuestion,
  | "isTrue"
  | "choices"
  | "correctIndex"
  | "expectedAnswer"
  | "acceptableAnswers"
  | "gradingNotes"
  | "freeformAnswerShape"
>;

/**
 * Per-format save context. Only `config` is needed today (for choice bounds),
 * but the shape leaves room for future cross-format inputs.
 */
export interface SaveValidationContext {
  config: TriviaConfig | null;
  /**
   * The cascade-resolved `judgeLeniency` for this coordinate. Handlers that judge
   * answers (freeform) stamp it on the record when it differs from the default; handlers
   * that don't (boolean/choice) ignore it. Resolved once by `save_question` via
   * `resolveCascade` and handed down so format-specific stamping stays in the handler.
   */
  resolvedJudgeLeniency: JudgeLeniency;
}

/**
 * Per-format suggestion-roll dependencies: the full cascade context. A handler rolls its
 * own per-format suggestions — boolean a coin-flip, choice count/index from the
 * workspace-only choice bounds (`cascadeCtx.config`), freeform the `freeformAnswerShape`.
 * Cascade-member axes (e.g. `freeformAnswerShape`) MUST be resolved through
 * `resolveCascade(key, cascadeCtx)`, never a legacy per-axis resolver, so a handler's roll
 * and `explain_cascade` agree.
 */
export interface SuggestionRollDeps {
  cascadeCtx: CascadeContext;
}

/**
 * Per-handler interaction-registration dependencies. The handler uses these
 * to scope question lookups, resolve game ownership, and refresh roster
 * footers after a click.
 */
export interface InteractionRegistrationDeps {
  data: TriviaDataLayer;
  getGameNames: () => string[];
}

/**
 * The shape returned by `getSavedQuestion`. On success, carries the complete
 * persistable `TriviaQuestion` (cross-format base + per-format fields). On
 * failure, carries a Claude-readable error the tool surfaces verbatim. The
 * combined validate+compose contract eliminates the "did I validate before
 * I composed?" ordering trap a two-method interface invited.
 */
export type GetSavedQuestionOutcome =
  | { ok: true; question: TriviaQuestion }
  | { ok: false; error: string };

export interface AnswerTypeHandler {
  /**
   * Short prose describing the answer-affordance attached to question cards in
   * this format (vote buttons, modal trigger, etc.). Composed into the
   * `post_questions` tool description at boot so the tool's prose stays in sync
   * with what `appendActionsBlock` actually emits.
   */
  readonly actionAffordanceDescription: string;

  /**
   * Short prose describing the shape of the `reveal.answer` payload entry in
   * this format. Composed into the `process_reveal_answers` tool description
   * at boot — keeps the wire-shape doc in sync with `buildRevealAnswer`.
   */
  readonly revealAnswerShapeDescription: string;

  /**
   * Short prose describing the per-format return shape of `get_question_history`
   * for this format. Composed into the tool description at boot — keeps it in
   * sync with `buildHistoryResult`.
   */
  readonly historyResultShapeDescription: string;

  /**
   * Append the question's answer-affordance block (buttons for vote / freeform
   * Answer button) to the END of the supplied Block Kit array.
   *
   * @param blocks The question card's existing blocks (FOUR-block layout —
   *   header / patter / card / closer).
   * @param actionId The plugin SDK's action-id namespacer
   *   (e.g. `(key) => \`plugin:trivia:\${key}\``).
   * @param question The question record being posted.
   */
  appendActionsBlock(
    blocks: SlackBlocks,
    actionId: (key: string) => string,
    question: TriviaQuestion,
  ): SlackBlocks;

  /**
   * Per-row grouping key for the live roster footer. Two rows that share a
   * key go in the same answered-bucket. Boolean: `"true"` / `"false"`. Choice:
   * `"0"` / `"1"` / `"2"` / `"3"`. Freeform: a normalized form of the typed
   * text. Returns null when the row's payload doesn't match the expected
   * shape (a stale row from a different format).
   */
  rosterGroupKey(answer: SubmittedAnswer): string | null;

  /**
   * Per-group display label for the roster footer (in visible mode). The
   * handler owns ALL format-specific styling — quotes around freeform text,
   * numbered emoji for choices, thumbs for boolean. The consumer (roster
   * renderer) concatenates the returned string without further formatting.
   *
   * @param group The fully assembled group: `groupKey` (from `rosterGroupKey`)
   *   plus every row whose `rosterGroupKey` matched this key. Handlers may
   *   inspect representative rows when the key alone doesn't carry enough
   *   info (e.g. freeform needs original casing from a row's `answerText`).
   * @param question The question record being rendered.
   */
  rosterGroupLabel(
    group: { groupKey: string; rows: readonly SubmittedAnswer[] },
    question: TriviaQuestion,
  ): string;

  /**
   * Emit the descriptive answer payload for this question — what the reveal
   * renderer sees in `reveals[i].answer`. Each handler knows its own shape;
   * the reveal flow doesn't switch on format strings.
   */
  buildRevealAnswer(question: TriviaQuestion): RevealAnswerDescriptor;

  /**
   * Human-readable form of the CORRECT answer for the static reveal footer's
   * "Answer was: …" line. Boolean → localized TRUE/FALSE; choice → the correct
   * option text; freeform → `expectedAnswer`. Keeps the shared footer renderer
   * free of format-string branching.
   */
  formatCorrectAnswer(question: TriviaQuestion): string;

  /**
   * Human-readable form of ONE user's submitted answer for the private "See
   * your answer" modal. Boolean → localized TRUE/FALSE from `row.answer`;
   * choice → the chosen option text from `row.answerIndex` (falls back to a
   * neutral placeholder when out of range); freeform → `row.answerText`.
   * Callers pass a row that belongs to this question; an unparseable/empty row
   * yields an empty string (the modal then renders the "did not answer" line).
   */
  formatSubmittedAnswer(question: TriviaQuestion, row: SubmittedAnswer): string;

  /**
   * Full reveal-time processing for one question. Each handler owns the end-
   * to-end logic for its format: validation invariants, reaction fetching (if
   * applicable), judge calls (freeform), persistence (flipping pending rows,
   * stamping `processedAt`), and voter-bucket assembly. The reveal flow just
   * iterates targets and accumulates the returned entries.
   *
   * Reprocess mode is the handler's choice: boolean/choice re-derive the verdict
   * (`correct`) on each retained answer row from the current question key (raw
   * answers are never deleted); freeform rejects (the judged modal submissions are
   * immutable, so there is nothing to safely re-derive).
   *
   * Errors return as `{ ok: false, error }` rather than throwing — the
   * reveal flow accumulates them into its per-id `errors` list.
   */
  processReveal(question: TriviaQuestion, deps: ProcessRevealDeps): Promise<ProcessRevealOutcome>;

  /**
   * Assemble the reveal entry (answer descriptor + voter buckets) for one
   * question from its ALREADY-SCORED answers, performing NO writes — no
   * judging, no `processedAt` stamp, no row deletion. Used by
   * `update_answers_block` to re-project a card deterministically from file
   * state. `processReveal` delegates here after it finishes its writes, so the
   * two share one bucket-assembly path. Returns the same `ProcessRevealOutcome`
   * shape; `wasReprocessed` is `false` (projection is not a reprocess).
   */
  projectReveal(question: TriviaQuestion, deps: ProjectRevealDeps): Promise<ProcessRevealOutcome>;

  /**
   * Validate the per-format save args AND compose the persistable
   * `TriviaQuestion` in one step. The tool runs all cross-format checks
   * (statement length / emoji count / slot / category / context / fact-vs-topical
   * / sourceUrl) BEFORE calling this; this method's only job is to handle the
   * per-format slice and produce the final record.
   *
   * Returning a single union (record-or-error) — rather than splitting into
   * separate validate + build methods — keeps the contract simple and ensures
   * a caller can never "compose without validating." Adding a new format means
   * writing one method, not two.
   */
  getSavedQuestion(
    base: TriviaQuestionBase,
    args: SaveQuestionArgs,
    ctx: SaveValidationContext,
  ): GetSavedQuestionOutcome;

  /**
   * Roll the per-format suggestion metadata returned by get_ideas. The tool
   * picks the format first; the handler then attaches its own roll fields
   * (boolean: `suggestedAnswer`; choice: `suggestedChoiceCount` +
   * `suggestedCorrectIndex`; freeform: `suggestedFreeformAnswerShape`).
   *
   * Returned as a flat record so the tool can spread it onto its response.
   */
  rollGenerationSuggestions(deps: SuggestionRollDeps): Record<string, JsonValue>;

  /**
   * Project a question + matching answer rows into the get_question_history
   * response payload. Each handler owns its own shape; freeform stops falling
   * through to the boolean shape (the pre-existing bug). The tool composes
   * the format-agnostic extras (`questionType`, `cheaterUserIds`, `context`,
   * `sourceUrl`, `eventDate`) on top of the handler's projection.
   */
  buildHistoryResult(
    question: TriviaQuestion,
    matching: readonly SubmittedAnswer[],
    users: ReadonlyMap<string, TriviaUser>,
  ): JsonValue;

  /**
   * Non-secret per-format fields for the `find_previous_questions` search
   * projection. The tool spreads this onto its result record. Answer-key
   * fields (boolean's `isTrue`, choice's `correctIndex`, freeform's
   * `expectedAnswer`/`acceptableAnswers`/`gradingNotes`) MUST NOT appear —
   * those are reachable only via the admin-tier `get_question_history` tool.
   * Choice surfaces its option list here because the option strings are not
   * the answer key (only the `correctIndex` is).
   */
  buildSearchResult(question: TriviaQuestion): Record<string, JsonValue>;

  /**
   * Register the handler's interaction action_id patterns with the SDK. Called
   * once at plugin boot per handler. Boolean and choice register `^vote:...$`
   * via a shared helper; freeform registers `^freeform-answer:...$` for its
   * modal-trigger flow. The caller (`registerInteractiveHandlers`) is a thin
   * registry loop — it doesn't know what regex each handler registers.
   */
  registerInteractions(sdk: ClackSdk, deps: InteractionRegistrationDeps): void;
}

/**
 * Extension implemented by formats that score answers synchronously at click
 * time (boolean and choice). Freeform's click handler doesn't return scoring
 * — its rows persist with `correct: undefined` until the reveal-time judge
 * runs, which is a wholly separate pipeline.
 */
export interface ClickableAnswerHandler extends AnswerTypeHandler {
  /**
   * Parse and score a click. Returns the opaque click value paired with a
   * correctness boolean, or null when the raw value doesn't match the format's
   * expected shape (malformed action_id, out-of-range index, etc.).
   *
   * @param rawValue The trailing payload from the vote action_id
   *   (`plugin:trivia:vote:<questionId>:<rawValue>`). For boolean: `"true"` |
   *   `"false"`. For choice: `"0"` | `"1"` | ... | `"<choices.length - 1>"`.
   * @param question The question record (needed for `isTrue` / `correctIndex`
   *   + the choices-length bound check).
   */
  resolveClick(rawValue: string, question: TriviaQuestion): ResolvedClick | null;

  /**
   * Convert a `ResolvedClick` into the `Partial<SubmittedAnswer>` to merge
   * into the persisted row. Boolean emits `{ answer, correct }`; choice emits
   * `{ answerIndex, correct }`. The caller never inspects the click's
   * internal payload — it just calls this to get the patch.
   *
   * Callers that overwrite an existing row should additionally pass a
   * `timestamp` and use `cleared` to zero out the sibling field of the OTHER
   * format on the same row (defensive against a row written under one format
   * being re-clicked under another mid-deploy; in practice the discriminator
   * on the question prevents this, but the patch leaves the sibling clear).
   */
  toAnswerPatch(resolved: ResolvedClick): Partial<SubmittedAnswer>;
}

/**
 * Type guard for the clickable narrowing. Used by the vote action handler to
 * refuse non-clickable formats (freeform) before any persistence work.
 */
export function isClickableHandler(handler: AnswerTypeHandler): handler is ClickableAnswerHandler {
  return "resolveClick" in handler;
}
