import type { SubmittedAnswer } from "../../core/types.js";
import type { TeamDef, TeamsScoringMode } from "../../core/configTypes.js";
import type { QuestionPointsMap } from "../computeLeaderboard.js";
import { isTeamOwnerKey, teamNameFromOwnerKey } from "../../answering/teamKey.js";
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
 * Two answer shapes coexist and sum per team:
 *  - AGGREGATE (individual-mode questions): member rows keyed by userId → team,
 *    scored per question through the mode's registry strategy.
 *  - SLOT (byTeam-mode questions): a single synthetic `team:<name>` row per team
 *    per question (the shared-buzzer answer), matched to the roster by NAME and
 *    paid the question's stamped points on a correct verdict. The aggregate
 *    scoring modes don't apply (one authoritative row, not member votes).
 * A question is stamped exactly one of these, so a `(team, questionId)` pair is
 * never counted twice. Every roster team gets a standing (0 when it never
 * answered). Sorted points-desc, name-asc tiebreak.
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
  const teamIndexByName = new Map(roster.map((team, i) => [team.name.toLowerCase(), i]));

  // Per team: questionId → member answers (aggregate) or a single slot verdict.
  const perTeamAggregate: Map<string, ScoredMemberAnswer[]>[] = roster.map(() => new Map());
  const perTeamSlots: Map<string, boolean>[] = roster.map(() => new Map());
  for (const answer of answers) {
    if (answer.correct === undefined) continue;
    if (filterSeason !== null && answer.season !== filterSeason) continue;
    if (isTeamOwnerKey(answer.userId)) {
      const teamIndex = teamIndexByName.get(teamNameFromOwnerKey(answer.userId).toLowerCase());
      if (teamIndex === undefined) continue;
      perTeamSlots[teamIndex].set(answer.questionId, answer.correct);
      continue;
    }
    if (excludeUserIds?.has(answer.userId)) continue;
    const teamIndex = teamIndexByUser.get(answer.userId);
    if (teamIndex === undefined) continue;
    const byQuestion = perTeamAggregate[teamIndex];
    const rows = byQuestion.get(answer.questionId);
    if (rows === undefined) byQuestion.set(answer.questionId, [{ correct: answer.correct }]);
    else rows.push({ correct: answer.correct });
  }

  return roster
    .map((team, i) => {
      let points = 0;
      const aggregate = perTeamAggregate[i];
      for (const [questionId, memberAnswers] of aggregate) {
        points += strategy.scoreQuestion(memberAnswers, questionPoints.get(questionId) ?? 1);
      }
      const slots = perTeamSlots[i];
      for (const [questionId, correct] of slots) {
        if (correct) points += questionPoints.get(questionId) ?? 1;
      }
      return { name: team.name, points, answeredQuestions: aggregate.size + slots.size };
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
