import type { SubmittedAnswer } from "../../core/types.js";
import type { TeamDef, TeamsScoringMode } from "../../core/configTypes.js";
import type { QuestionPointsMap } from "../computeLeaderboard.js";
import { TEAM_SCORING_REGISTRY, type ScoredMemberAnswer } from "./scoring.js";

export interface TeamStanding {
  name: string;
  points: number;
  /** Count of questions in scope where at least one member submitted a scored answer. */
  answeredQuestions: number;
}

/**
 * userId → roster index. The one place membership lookup is derived from a
 * roster — shared with the voter-bucket grouping so membership semantics
 * (e.g. a future case-handling rule) can never diverge between scoring and
 * rendering.
 */
export function buildTeamIndexByUser(roster: readonly TeamDef[]): Map<string, number> {
  const teamIndexByUser = new Map<string, number>();
  roster.forEach((team, i) => {
    for (const id of team.userIds) teamIndexByUser.set(id, i);
  });
  return teamIndexByUser;
}

/**
 * Pure projection of team scores over UNCHANGED `SubmittedAnswer` rows — no
 * team attribution is ever persisted, so membership edits recompute
 * retroactively for free. Sibling of `computeLeaderboard` with the same
 * exclusions: pending freeform rows (`correct === undefined`) are skipped, and
 * callers pass cheaters + the bot via `excludeUserIds` (the same set the
 * reveal's round summary builds with `buildExcludeSet`).
 *
 * Every roster team gets a standing (0 points when no member answered), scored
 * per question through the mode's registry strategy and paid the question's
 * stamped points. Sorted points-desc, name-asc tiebreak.
 */
export function computeTeamStandings(
  answers: readonly SubmittedAnswer[],
  roster: readonly TeamDef[],
  mode: TeamsScoringMode,
  filterSeason: string | null,
  questionPoints: QuestionPointsMap,
  excludeUserIds?: ReadonlySet<string>,
): TeamStanding[] {
  const strategy = TEAM_SCORING_REGISTRY[mode];
  const teamIndexByUser = buildTeamIndexByUser(roster);

  // Per team: questionId → that team's scored member answers.
  const perTeam: Map<string, ScoredMemberAnswer[]>[] = roster.map(() => new Map());
  for (const answer of answers) {
    if (answer.correct === undefined) continue;
    if (excludeUserIds?.has(answer.userId)) continue;
    if (filterSeason !== null && answer.season !== filterSeason) continue;
    const teamIndex = teamIndexByUser.get(answer.userId);
    if (teamIndex === undefined) continue;
    const byQuestion = perTeam[teamIndex];
    const rows = byQuestion.get(answer.questionId);
    if (rows === undefined) byQuestion.set(answer.questionId, [{ correct: answer.correct }]);
    else rows.push({ correct: answer.correct });
  }

  return roster
    .map((team, i) => {
      let points = 0;
      const byQuestion = perTeam[i];
      for (const [questionId, memberAnswers] of byQuestion) {
        points += strategy.scoreQuestion(memberAnswers, questionPoints.get(questionId) ?? 1);
      }
      return { name: team.name, points, answeredQuestions: byQuestion.size };
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
