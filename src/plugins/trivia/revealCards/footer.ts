/**
 * Static results-footer renderer for the reveal-time card edit. Produces the
 * divider + section blocks that replace the live "Answered: …" roster footer
 * once a question is revealed.
 *
 * Voter disclosure branches on the question's stamped `revealResponses` mode
 * (the `VoterBuckets` discriminant), so all four modes are honored from a
 * single renderer:
 *  - `"yes"` / `"just-correctness"`: name the correct / incorrect / no-answer
 *    buckets (these two variants differ only by freeform `answerText`, which
 *    the footer never prints anyway).
 *  - `"just-winners"`: name the winners; render anonymous counts for the
 *    missers and non-answerers.
 *  - `"no"`: the answer line only — no names, no counts.
 *
 * Every mode renders an "Answer was: …" line from the caller-supplied
 * `answerLine` (produced by the handler's `formatCorrectAnswer`). The footer
 * carries no Claude-generated text and no reaction commentary.
 */

import type { DividerBlock, SectionBlock } from "@slack/types";
import { t } from "../i18n/t.js";
import { renderPlayerRef } from "../domain/tagPlayers.js";
import { isTeamOwnerKey, teamNameFromOwnerKey } from "../answering/teamKey.js";
import type {
  TeamBucketEntry,
  TeamVoterBuckets,
  Voter,
  VoterBuckets,
} from "../tools/reveal/types.js";

// A shared-buzzer question's voter rows carry synthetic `team:<name>` ids — render
// them as the bold team name (never a mention). Individual rows use the player ref.
function renderVoterName(v: Voter, tagPlayers: boolean): string {
  if (isTeamOwnerKey(v.userId)) return `*${teamNameFromOwnerKey(v.userId)}*`;
  return renderPlayerRef(v.userId, v.displayName, tagPlayers);
}

function renderNames(voters: readonly Voter[], tagPlayers: boolean): string {
  return voters.map((v) => renderVoterName(v, tagPlayers)).join(", ");
}

function teamNames(entries: readonly TeamBucketEntry[]): string[] {
  return entries.map((entry) => entry.team);
}

/**
 * Team names first (plain text — never Slack mentions), then free agents via
 * `renderPlayerRef` honoring the stamped `tagPlayers`. Member answer texts are
 * NOT printed — the footer never prints texts in individual mode either; they
 * live in the payload for the Claude-authored narrative.
 */
function renderTeamBucket(
  names: readonly string[],
  freeAgents: readonly Voter[],
  tagPlayers: boolean,
): string {
  const agentNames = freeAgents.map((v) => renderVoterName(v, tagPlayers));
  return [...names, ...agentNames].join(", ");
}

/**
 * Build the static results footer blocks for one revealed question. Returns a
 * divider followed by a single mrkdwn section; empty voter buckets are omitted
 * rather than rendered as placeholder lines.
 *
 * When `teamVoters` is supplied (teams mode ON), the named buckets render team
 * names in place of member names — members are absorbed; free agents are still
 * named individually. The `just-winners` anonymous counts and the `"no"` mode
 * are unchanged.
 */
export function buildRevealFooterBlocks(
  voters: VoterBuckets,
  answerLine: string,
  questionId: string,
  tagPlayers: boolean,
  teamVoters?: TeamVoterBuckets,
): [DividerBlock, SectionBlock] {
  const lines: string[] = [t("reveal.answer_was", { answer: answerLine })];

  switch (voters.revealResponses) {
    case "yes":
    case "just-correctness": {
      if (teamVoters !== undefined) {
        const correct = renderTeamBucket(
          teamNames(teamVoters.correctTeams),
          teamVoters.correctFreeAgents,
          tagPlayers,
        );
        if (correct.length > 0) lines.push(t("reveal.correct_label", { names: correct }));
        const incorrect = renderTeamBucket(
          teamNames(teamVoters.incorrectTeams ?? []),
          teamVoters.incorrectFreeAgents ?? [],
          tagPlayers,
        );
        if (incorrect.length > 0) lines.push(t("reveal.incorrect_label", { names: incorrect }));
        const noAnswer = renderTeamBucket(
          teamVoters.noAnswerTeams ?? [],
          teamVoters.noAnswerFreeAgents ?? [],
          tagPlayers,
        );
        if (noAnswer.length > 0) lines.push(t("reveal.no_answer_label", { names: noAnswer }));
        break;
      }
      if (voters.correct.length > 0) {
        lines.push(t("reveal.correct_label", { names: renderNames(voters.correct, tagPlayers) }));
      }
      if (voters.incorrect.length > 0) {
        lines.push(
          t("reveal.incorrect_label", { names: renderNames(voters.incorrect, tagPlayers) }),
        );
      }
      if (voters.noAnswer.length > 0) {
        lines.push(
          t("reveal.no_answer_label", { names: renderNames(voters.noAnswer, tagPlayers) }),
        );
      }
      break;
    }
    case "just-winners": {
      const winners =
        teamVoters !== undefined
          ? renderTeamBucket(
              teamNames(teamVoters.correctTeams),
              teamVoters.correctFreeAgents,
              tagPlayers,
            )
          : voters.correct.length > 0
            ? renderNames(voters.correct, tagPlayers)
            : "";
      if (winners.length > 0) {
        lines.push(t("reveal.correct_label", { names: winners }));
      }
      if (voters.incorrectCount > 0) {
        lines.push(t("reveal.n_incorrect", { count: voters.incorrectCount }));
      }
      if (voters.noAnswerCount > 0) {
        lines.push(t("reveal.n_no_answer", { count: voters.noAnswerCount }));
      }
      break;
    }
    case "no":
      break;
  }

  return [
    { type: "divider", block_id: `reveal-results-divider:${questionId}` },
    {
      type: "section",
      block_id: `reveal-results:${questionId}`,
      text: { type: "mrkdwn", text: lines.join("\n") },
    },
  ];
}
