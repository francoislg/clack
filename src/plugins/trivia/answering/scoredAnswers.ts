import type { ScopedTriviaDataLayer, SubmittedAnswer } from "../core/types.js";
import { projectTeamSlotToRow } from "./byTeam.js";

/**
 * The game-wide scored view, independent of any one question's ownership model:
 * every individual answer row plus every team slot projected into
 * `SubmittedAnswer` shape. This is the leaderboard/standings source of truth
 * across a mixed game (some questions individual, some byTeam). Team slots are
 * empty for pure-individual games, so this is inert there.
 *
 * Lives in the answering seam (alongside the strategies) so the raw-row read
 * stays inside the scoring-view boundary the guard enforces — consumers depend
 * on this projection, never on `scoped.loadAnswers()` directly.
 */
export async function loadAllScoredAnswers(
  scoped: ScopedTriviaDataLayer,
): Promise<SubmittedAnswer[]> {
  const [raw, slots] = await Promise.all([scoped.loadAnswers(), scoped.loadTeamAnswers()]);
  return [...raw, ...slots.map(projectTeamSlotToRow)];
}
