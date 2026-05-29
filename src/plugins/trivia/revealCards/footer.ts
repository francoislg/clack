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
import type { Voter, VoterBuckets } from "../tools/reveal/types.js";

function renderNames(voters: readonly Voter[]): string {
  return voters.map((v) => `<@${v.userId}>`).join(", ");
}

/**
 * Build the static results footer blocks for one revealed question. Returns a
 * divider followed by a single mrkdwn section; empty voter buckets are omitted
 * rather than rendered as placeholder lines.
 */
export function buildRevealFooterBlocks(
  voters: VoterBuckets,
  answerLine: string,
  questionId: string,
): [DividerBlock, SectionBlock] {
  const lines: string[] = [t("reveal.answer_was", { answer: answerLine })];

  switch (voters.revealResponses) {
    case "yes":
    case "just-correctness": {
      if (voters.correct.length > 0) {
        lines.push(t("reveal.correct_label", { names: renderNames(voters.correct) }));
      }
      if (voters.incorrect.length > 0) {
        lines.push(t("reveal.incorrect_label", { names: renderNames(voters.incorrect) }));
      }
      if (voters.noAnswer.length > 0) {
        lines.push(t("reveal.no_answer_label", { names: renderNames(voters.noAnswer) }));
      }
      break;
    }
    case "just-winners": {
      if (voters.correct.length > 0) {
        lines.push(t("reveal.correct_label", { names: renderNames(voters.correct) }));
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
