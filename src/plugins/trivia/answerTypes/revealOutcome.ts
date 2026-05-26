/**
 * Output-shape helper for reveal-time handlers. `makeRevealOutcome` packages
 * the per-handler pieces (answer descriptor + voter buckets) into the
 * `ProcessRevealOutcome` shape the reveal flow accumulates. The
 * `messageLink` guard handles the unusual case of a question that was
 * scheduled but never posted.
 */

import { triviaLogger as logger } from "../core/pluginLogger.js";
import type { TriviaQuestion } from "../core/types.js";
import type { VoterBuckets } from "../tools/reveal/types.js";
import type { ProcessRevealOutcome, RevealAnswerDescriptor } from "./types.js";

/**
 * Package a successful reveal outcome from per-handler pieces. The handler
 * supplies the answer descriptor and voter buckets; this helper stitches
 * them onto the question's shared metadata.
 */
export function makeRevealOutcome(
  question: TriviaQuestion,
  answer: RevealAnswerDescriptor,
  voters: VoterBuckets,
  wasReprocessed: boolean,
): ProcessRevealOutcome {
  if (!question.messageLink) {
    logger.warn(`[trivia:reveal] makeRevealOutcome called with no messageLink on ${question.id}`);
    return { ok: false, error: "question is missing messageLink" };
  }
  return {
    ok: true,
    entry: {
      questionId: question.id,
      statement: question.statement,
      category: question.category,
      emojis: question.emojis ?? [],
      messageLink: question.messageLink,
      wasReprocessed,
      answer,
      voters,
    },
  };
}
