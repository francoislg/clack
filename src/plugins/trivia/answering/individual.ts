import { renderPlayerRef } from "../domain/tagPlayers.js";
import type { ScopedTriviaDataLayer, SubmittedAnswer, TriviaDataLayer } from "../core/types.js";
import type { AnswerPatch, AnsweringStrategy, OwnerLabelDeps } from "./types.js";

/**
 * The legacy answer-ownership model: every answer is owned by its `(userId,
 * questionId)` row in `answers.json`. Reads pass through unprojected; writes
 * upsert by that key. `ownerKey` IS the `userId`.
 */
export function createIndividualAnswering(
  scoped: ScopedTriviaDataLayer,
  data: Pick<TriviaDataLayer, "recordJoin" | "refreshIdentities">,
): AnsweringStrategy {
  async function getCurrentAnswerFor(
    userId: string,
    questionId: string,
  ): Promise<SubmittedAnswer | undefined> {
    const answers = await scoped.loadAnswers();
    return answers.find((a) => a.userId === userId && a.questionId === questionId);
  }

  async function answer(
    userId: string,
    questionId: string,
    patch: AnswerPatch,
    opts: { season?: string },
  ): Promise<void> {
    const now = Date.now();
    const existing = await getCurrentAnswerFor(userId, questionId);
    if (existing !== undefined) {
      await scoped.updateAnswer(userId, questionId, { ...patch, timestamp: now });
      return;
    }
    const row: SubmittedAnswer = {
      userId,
      questionId,
      timestamp: now,
      ...patch,
      ...(opts.season !== undefined ? { season: opts.season } : {}),
    };
    await scoped.saveAnswer(row);
    await data.recordJoin(userId);
    await data.refreshIdentities([userId]);
  }

  async function getFinalAnswers(questionId: string): Promise<SubmittedAnswer[]> {
    const answers = await scoped.loadAnswers();
    return answers.filter((a) => a.questionId === questionId);
  }

  async function getAllScoredAnswers(): Promise<SubmittedAnswer[]> {
    return scoped.loadAnswers();
  }

  async function applyVerdict(
    ownerKey: string,
    questionId: string,
    patch: AnswerPatch,
  ): Promise<void> {
    await scoped.updateAnswer(ownerKey, questionId, patch);
  }

  function ownerLabel(ownerKey: string, deps: OwnerLabelDeps): string {
    const displayName = deps.users.get(ownerKey)?.displayName ?? ownerKey;
    return renderPlayerRef(ownerKey, displayName, deps.tagPlayers);
  }

  return {
    getCurrentAnswerFor,
    answer,
    getFinalAnswers,
    getAllScoredAnswers,
    applyVerdict,
    ownerLabel,
  };
}
