/**
 * Read-only "See your answer" modal, opened from the post-reveal button on
 * every question card. Generalizes freeform's locked-modal verdict to all three
 * formats by routing the user's submitted answer through the answer-type
 * handler's `formatSubmittedAnswer`. The verdict lines reuse the existing
 * `modal.verdict_*` strings; a missing row renders "you did not answer".
 *
 * The modal has only a Close button — it never records or modifies an answer.
 */

import type { ModalView } from "@slack/web-api";
import { getAnswerTypeHandler } from "../answerTypes/registry.js";
import type { SubmittedAnswer, TriviaQuestion } from "../core/types.js";
import { t } from "../i18n/t.js";

/** Escape Slack mrkdwn special characters for quoted answer text. */
function escapeMarkdown(s: string): string {
  return s.replace(/[*_`<>&]/g, (ch) => `\\${ch}`);
}

export interface BuildSeeAnswerModalParams {
  question: TriviaQuestion;
  /** The clicking user's submitted row for this question, if any. */
  myRow?: SubmittedAnswer;
}

/** Build the Slack modal view showing the clicking user's own answer + verdict. */
export function buildSeeAnswerModal(params: BuildSeeAnswerModalParams): ModalView {
  const { question, myRow } = params;
  const handler = getAnswerTypeHandler(question.answersFormat);
  const answerText = myRow !== undefined ? handler.formatSubmittedAnswer(question, myRow) : "";

  const verdictText =
    myRow === undefined || answerText.length === 0
      ? t("modal.verdict_no_submission")
      : myRow.correct === undefined
        ? t("modal.verdict_awaiting", { answer: escapeMarkdown(answerText) })
        : myRow.correct
          ? t("modal.verdict_correct", { answer: escapeMarkdown(answerText) })
          : t("modal.verdict_incorrect", { answer: escapeMarkdown(answerText) });

  return {
    type: "modal",
    title: { type: "plain_text", text: t("modal.title_see_answer"), emoji: true },
    close: { type: "plain_text", text: t("modal.close"), emoji: true },
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: t("modal.question_header", { category: question.category }),
          emoji: true,
        },
      },
      { type: "section", text: { type: "mrkdwn", text: question.statement } },
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: verdictText } },
    ],
  };
}
