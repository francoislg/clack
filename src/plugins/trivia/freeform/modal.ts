import type { ModalView } from "@slack/web-api";
import type { TriviaQuestion } from "../core/types.js";
import { t } from "../i18n/t.js";

const INPUT_BLOCK_ID = "freeform-answer-input";
const ACTION_ID = "answerText";

/** Trim down to 200 chars to keep the storage shape predictable. */
export const MAX_ANSWER_LENGTH = 200;

export interface BuildFreeformModalParams {
  callbackId: string;
  question: TriviaQuestion;
  /** The user's prior pending answer text, when one exists. Pre-fills the input. */
  pendingAnswer?: string;
  /**
   * When `true`, the modal renders read-only — used when `processedAt` is set on
   * the question (the reveal has run). The locked view shows the user's prior
   * submission and the judged verdict, if any.
   */
  locked: boolean;
  /**
   * Required when `locked` is true. The user's already-submitted row, if any.
   * Drives the read-only display ("you answered: X — correct/incorrect"); a missing
   * row renders as "you did not submit an answer."
   */
  lockedRow?: {
    answerText: string;
    correct?: boolean;
  };
  /** The game name — passed through `private_metadata` so the view-submit handler can scope writes. */
  game: string;
}

/**
 * Build the Slack modal view for the freeform answer flow. The view is shaped
 * for both the active (editable input) and locked (post-reveal read-only) modes.
 */
export function buildFreeformModal(params: BuildFreeformModalParams): ModalView {
  const { question, pendingAnswer, locked, lockedRow, callbackId, game } = params;

  const headerBlocks: ModalView["blocks"] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: t("modal.question_header", { category: question.category }),
        emoji: true,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: question.statement },
    },
  ];

  if (locked) {
    const verdictText =
      lockedRow === undefined
        ? t("modal.verdict_no_submission")
        : lockedRow.correct === undefined
          ? t("modal.verdict_awaiting", { answer: escapeMarkdown(lockedRow.answerText) })
          : lockedRow.correct
            ? t("modal.verdict_correct", { answer: escapeMarkdown(lockedRow.answerText) })
            : t("modal.verdict_incorrect", { answer: escapeMarkdown(lockedRow.answerText) });

    return {
      type: "modal",
      callback_id: callbackId,
      private_metadata: JSON.stringify({ game, questionId: question.id }),
      title: { type: "plain_text", text: t("modal.title_locked"), emoji: true },
      close: { type: "plain_text", text: t("modal.close"), emoji: true },
      blocks: [
        ...headerBlocks,
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: verdictText } },
      ],
    };
  }

  return {
    type: "modal",
    callback_id: callbackId,
    private_metadata: JSON.stringify({ game, questionId: question.id }),
    title: { type: "plain_text", text: t("modal.title_active"), emoji: true },
    submit: { type: "plain_text", text: t("modal.submit"), emoji: true },
    close: { type: "plain_text", text: t("modal.cancel"), emoji: true },
    blocks: [
      ...headerBlocks,
      { type: "divider" },
      {
        type: "input",
        block_id: INPUT_BLOCK_ID,
        label: { type: "plain_text", text: t("modal.input_label"), emoji: true },
        element: {
          type: "plain_text_input",
          action_id: ACTION_ID,
          max_length: MAX_ANSWER_LENGTH,
          ...(pendingAnswer !== undefined ? { initial_value: pendingAnswer } : {}),
          placeholder: { type: "plain_text", text: t("modal.input_placeholder"), emoji: true },
        },
        hint: {
          type: "plain_text",
          text: t("modal.input_hint"),
          emoji: true,
        },
      },
    ],
  };
}

/** Extract the user's text from a Slack view-submission payload. */
export function readAnswerTextFromSubmission(view: {
  state: { values: Record<string, Record<string, { value?: string | null }>> };
}): string {
  const input = view.state.values[INPUT_BLOCK_ID]?.[ACTION_ID];
  return (input?.value ?? "").trim();
}

/** Parse private_metadata written by buildFreeformModal. */
export function readModalMetadata(
  privateMetadata: string,
): { game: string; questionId: string } | null {
  if (privateMetadata.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(privateMetadata);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "game" in parsed &&
      "questionId" in parsed &&
      typeof (parsed as { game: unknown }).game === "string" &&
      typeof (parsed as { questionId: unknown }).questionId === "string"
    ) {
      return {
        game: (parsed as { game: string }).game,
        questionId: (parsed as { questionId: string }).questionId,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Escape Slack mrkdwn special characters for quoted user text. */
function escapeMarkdown(s: string): string {
  return s.replace(/[*_`<>&]/g, (ch) => `\\${ch}`);
}

export const FREEFORM_MODAL_INTERNALS = {
  INPUT_BLOCK_ID,
  ACTION_ID,
};
