import type { ScopedTriviaDataLayer, TriviaDataLayer, TriviaQuestion } from "../core/types.js";
import { createByTeamAnswering } from "./byTeam.js";
import { createIndividualAnswering } from "./individual.js";
import type { AnsweringStrategy } from "./types.js";

/**
 * The ONE place answer ownership is chosen. Reads the question's STAMP, never
 * live config — a question is answered/read by the model in effect when it was
 * posed (`post_questions` freezes `answeringType` + `teamsStamp`). Legacy rows
 * carry neither field → individual, byte-for-byte the pre-feature path.
 *
 * A `byTeam` stamp with an absent/empty roster degrades to individual by
 * construction (every clicker is a free agent), so a corrupt stamp is never a
 * hard failure.
 */
export function selectAnsweringStrategy(
  question: Pick<TriviaQuestion, "answeringType" | "teamsStamp">,
  scoped: ScopedTriviaDataLayer,
  data: Pick<TriviaDataLayer, "recordJoin" | "refreshIdentities">,
): AnsweringStrategy {
  if (question.answeringType === "byTeam") {
    return createByTeamAnswering(scoped, data, question.teamsStamp?.teams ?? []);
  }
  return createIndividualAnswering(scoped, data);
}
