/**
 * The ANSWER-OWNERSHIP axis of trivia answering — orthogonal to the
 * `AnswerTypeHandler` SHAPE axis (boolean / choice / freeform).
 *
 * `AnswerTypeHandler` owns what a vote MEANS (parsing a click, rendering
 * buttons, grouping the roster, judging, reveal projection). `AnsweringStrategy`
 * owns who OWNS the persisted answer slot and how it is read back. The two
 * compose: a boolean question can be answered individually or by-team; the
 * handler is unchanged either way.
 *
 * Consumers dispatch through the strategy instead of keying `(userId,
 * questionId)` against the data layer directly — the same discipline the
 * `AnswerTypeHandler` rule imposes on the shape axis (no `answeringType`
 * branching in a consumer; the branch lives in the strategy implementation).
 *
 * One implementation ships today: `IndividualAnswering` (the legacy
 * `(userId, questionId)` model). A future `ByTeamAnswering` plugs in at the same
 * seam without touching any consumer.
 */

import type { SubmittedAnswer, TriviaUser } from "../core/types.js";

/**
 * The mutable fields a write may carry. The slot key (`userId`, `questionId`) and
 * `timestamp` are owned by the strategy, never the caller, so they are excluded —
 * a patch can only set answer payload and verdict fields.
 */
export type AnswerPatch = Partial<Omit<SubmittedAnswer, "userId" | "questionId" | "timestamp">>;

/**
 * Dependencies for `ownerLabel` — exactly what `renderPlayerRef` needs to render
 * an owner: the resolved `tagPlayers` flag (mention vs plain text) and the
 * identity map for display-name lookup. A future team strategy adds nothing here
 * (team names come from the stamped roster the strategy already holds).
 */
export interface OwnerLabelDeps {
  tagPlayers: boolean;
  users: ReadonlyMap<string, TriviaUser>;
}

export interface AnsweringStrategy {
  /**
   * The answer THIS clicker currently owns for the question, or `undefined` when
   * none exists. Drives the click/freeform-modal re-answer check and the modal
   * prefill. Individual: the `(userId, questionId)` row.
   */
  getCurrentAnswerFor(userId: string, questionId: string): Promise<SubmittedAnswer | undefined>;

  /**
   * Upsert `patch` into the slot this click owns, bumping `timestamp`. On a first
   * write the strategy also records the join side effects. `opts.season` tags a
   * newly-created row (ignored on update — an existing row keeps its season).
   * Individual: `(userId, questionId)` save-or-update, plus `recordJoin` +
   * `refreshIdentities` on first write.
   */
  answer(
    userId: string,
    questionId: string,
    patch: AnswerPatch,
    opts: { season?: string },
  ): Promise<void>;

  /**
   * The scored answers for ONE question, projected into `SubmittedAnswer` shape —
   * consumed by the live roster, reveal voter buckets, and per-question judging.
   * Individual: the raw rows filtered to `questionId`.
   */
  getFinalAnswers(questionId: string): Promise<SubmittedAnswer[]>;

  /**
   * Every scored answer across the game, projected into `SubmittedAnswer` shape —
   * consumed by the leaderboard and `retrieve_scores`. Individual: the raw rows.
   */
  getAllScoredAnswers(): Promise<SubmittedAnswer[]>;

  /**
   * Merge a verdict `patch` (e.g. `{ correct }`, `{ correct, judgeReason }`) onto
   * the slot owned by `ownerKey` for `questionId` — the reveal judge, reprocess
   * re-derivation, and `settle_question`'s verdict clearing. `ownerKey` is the
   * `userId` today; a team strategy uses its own stable key. Individual:
   * delegates to the data layer's `updateAnswer(ownerKey, questionId, patch)`.
   */
  applyVerdict(ownerKey: string, questionId: string, patch: AnswerPatch): Promise<void>;

  /**
   * Render an owner for a deterministic Slack block. Individual: the player
   * reference (`<@USERID>` or `@displayName` per `tagPlayers`). A team strategy
   * renders the team name.
   */
  ownerLabel(ownerKey: string, deps: OwnerLabelDeps): string;
}
