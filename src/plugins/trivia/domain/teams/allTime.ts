import type { SeasonsState, SubmittedAnswer } from "../../core/types.js";
import type { TeamDef, TeamsScoringMode } from "../../core/configTypes.js";
import type { QuestionPointsMap } from "../computeLeaderboard.js";
import { computeTeamStandings } from "./computeTeamStandings.js";

/**
 * Compute each LIVE team's all-time points by case-insensitive name match over
 * stamped season history. A team's all-time = Σ over ended seasons whose
 * `teamsStamp` contains the same name (each scored with THAT season's stamped
 * roster + stamped mode) + the live season scored with the live roster + mode.
 *
 * Returns a map keyed by the live team's name, with an entry ONLY for teams
 * that matched at least one prior stamped season — a first-season team has no
 * all-time value (its cell renders empty). Ended seasons without a stamp
 * (teams were off, or legacy) contribute nothing.
 */
export function computeTeamAllTime(
  answers: readonly SubmittedAnswer[],
  seasonsState: SeasonsState | null,
  liveRoster: readonly TeamDef[],
  liveScoring: TeamsScoringMode,
  currentSlug: string | null,
  questionPoints: QuestionPointsMap,
  excludeUserIds?: ReadonlySet<string>,
): Map<string, number> {
  const result = new Map<string, number>();
  if (seasonsState === null) return result;

  const priorSeasons = seasonsState.seasons.filter(
    (s) => s.endedAt !== undefined && s.slug !== currentSlug && s.teamsStamp !== undefined,
  );

  for (const liveTeam of liveRoster) {
    const lower = liveTeam.name.toLowerCase();
    let priorTotal = 0;
    let matchedPrior = false;

    for (const season of priorSeasons) {
      const stamp = season.teamsStamp;
      if (stamp === undefined) continue;
      const stampedTeam = stamp.teams.find((t) => t.name.toLowerCase() === lower);
      if (stampedTeam === undefined) continue;
      matchedPrior = true;
      const [standing] = computeTeamStandings(
        answers,
        [stampedTeam],
        stamp.teamsScoring,
        season.slug,
        questionPoints,
        excludeUserIds,
      );
      priorTotal += standing.points;
    }

    if (!matchedPrior) continue;

    const [liveStanding] = computeTeamStandings(
      answers,
      [liveTeam],
      liveScoring,
      currentSlug,
      questionPoints,
      excludeUserIds,
    );
    result.set(liveTeam.name, priorTotal + liveStanding.points);
  }

  return result;
}
