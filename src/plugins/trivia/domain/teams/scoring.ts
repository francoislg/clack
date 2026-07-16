import type { TeamsScoringMode } from "../../core/configTypes.js";

/**
 * One team member's scored answer to ONE question. Callers pre-filter: pending
 * freeform rows (`correct === undefined`), cheaters, and the bot never reach a
 * strategy; a member who did not answer contributes no element.
 */
export interface ScoredMemberAnswer {
  correct: boolean;
}

/**
 * A pluggable team scoring algorithm. `questionPoints` is the question's
 * stamped worth (1 unless the points axis raised it) — team scoring is
 * points-aware, matching the points-primary individual scoring. An empty
 * `memberAnswers` (nobody on the team answered) MUST score 0.
 */
export interface TeamScoringStrategy {
  scoreQuestion(memberAnswers: readonly ScoredMemberAnswer[], questionPoints: number): number;
}

/**
 * The one place team-scoring behavior lives. The mapped type over
 * `TeamsScoringMode` makes a mode without a strategy (or vice versa) a compile
 * error — same exhaustiveness trick as `AXIS_REGISTRY`. Consumers resolve a
 * strategy here and never branch on the mode value.
 */
export const TEAM_SCORING_REGISTRY: Record<TeamsScoringMode, TeamScoringStrategy> = {
  "one-right-is-right": {
    scoreQuestion: (memberAnswers, questionPoints) =>
      memberAnswers.some((a) => a.correct) ? questionPoints : 0,
  },
  "total-points": {
    scoreQuestion: (memberAnswers, questionPoints) =>
      memberAnswers.filter((a) => a.correct).length * questionPoints,
  },
};
