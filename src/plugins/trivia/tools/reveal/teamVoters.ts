import type { TeamDef } from "../../core/configTypes.js";
import { buildTeamIndexByUser } from "../../domain/teams/computeTeamStandings.js";
import type { TeamBucketEntry, TeamVoterBuckets, Voter, VoterBuckets } from "./types.js";

/**
 * Project individual voter buckets into team-grouped buckets. A team's verdict:
 * Correct when ≥1 member is in the correct bucket; Incorrect when members
 * answered but none correctly; NoAnswer when no member answered but ≥1 member
 * reacted (the individual noAnswer semantics — a fully-absent team lands
 * nowhere). Members are absorbed into the team; free agents pass through as
 * individual `Voter`s. Freeform member `answerText`s (present under
 * `revealResponses: "yes"` only) are collected UNATTRIBUTED onto the team entry.
 *
 * Returns undefined for the `"no"` variant (no participation data to group).
 * Under `"just-winners"` only the correct bucket is grouped — misser texts and
 * names never leak past the anonymous counts on the underlying `voters`.
 */
export function groupVotersByTeam(
  voters: VoterBuckets,
  roster: readonly TeamDef[],
): TeamVoterBuckets | undefined {
  if (voters.revealResponses === "no") return undefined;

  const teamIndexByUser = buildTeamIndexByUser(roster);

  interface TeamAccumulator {
    answered: boolean;
    correct: boolean;
    reacted: boolean;
    answerTexts: string[];
  }
  const perTeam: TeamAccumulator[] = roster.map(() => ({
    answered: false,
    correct: false,
    reacted: false,
    answerTexts: [],
  }));

  function absorb(bucket: readonly Voter[], kind: "correct" | "incorrect" | "noAnswer"): Voter[] {
    const freeAgents: Voter[] = [];
    for (const voter of bucket) {
      const teamIndex = teamIndexByUser.get(voter.userId);
      if (teamIndex === undefined) {
        freeAgents.push(voter);
        continue;
      }
      const acc = perTeam[teamIndex];
      if (kind === "noAnswer") {
        acc.reacted = true;
        continue;
      }
      acc.answered = true;
      if (kind === "correct") acc.correct = true;
      if (voter.answerText !== undefined) acc.answerTexts.push(voter.answerText);
    }
    return freeAgents;
  }

  function teamEntry(index: number): TeamBucketEntry {
    const acc = perTeam[index];
    return {
      team: roster[index].name,
      ...(acc.answerTexts.length > 0 ? { answerTexts: acc.answerTexts } : {}),
    };
  }

  const correctFreeAgents = absorb(voters.correct, "correct");

  if (voters.revealResponses === "just-winners") {
    const correctTeams = roster
      .map((_, i) => i)
      .filter((i) => perTeam[i].correct)
      .map(teamEntry);
    return { correctTeams, correctFreeAgents };
  }

  const incorrectFreeAgents = absorb(voters.incorrect, "incorrect");
  const noAnswerFreeAgents = absorb(voters.noAnswer, "noAnswer");

  const correctTeams: TeamBucketEntry[] = [];
  const incorrectTeams: TeamBucketEntry[] = [];
  const noAnswerTeams: string[] = [];
  roster.forEach((team, i) => {
    const acc = perTeam[i];
    if (acc.correct) correctTeams.push(teamEntry(i));
    else if (acc.answered) incorrectTeams.push(teamEntry(i));
    else if (acc.reacted) noAnswerTeams.push(team.name);
  });

  return {
    correctTeams,
    correctFreeAgents,
    incorrectTeams,
    incorrectFreeAgents,
    noAnswerTeams,
    noAnswerFreeAgents,
  };
}
