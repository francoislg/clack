import type { ModalView } from "@slack/web-api";
import type { TriviaQuestion } from "../core/types.js";

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
      text: { type: "plain_text", text: `Question (${question.category})`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: question.statement },
    },
  ];

  if (locked) {
    const verdictText =
      lockedRow === undefined
        ? ":no_entry_sign: You did not submit an answer for this question."
        : lockedRow.correct === undefined
          ? `:hourglass_flowing_sand: Your answer: *${escapeMarkdown(lockedRow.answerText)}* — awaiting reveal`
          : lockedRow.correct
            ? `:white_check_mark: Your answer: *${escapeMarkdown(lockedRow.answerText)}* — correct!`
            : `:x: Your answer: *${escapeMarkdown(lockedRow.answerText)}* — incorrect`;

    return {
      type: "modal",
      callback_id: callbackId,
      private_metadata: JSON.stringify({ game, questionId: question.id }),
      title: { type: "plain_text", text: "Trivia — answered", emoji: true },
      close: { type: "plain_text", text: "Close", emoji: true },
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
    title: { type: "plain_text", text: "Trivia — your answer", emoji: true },
    submit: { type: "plain_text", text: "Submit answer", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      ...headerBlocks,
      { type: "divider" },
      {
        type: "input",
        block_id: INPUT_BLOCK_ID,
        label: { type: "plain_text", text: "Your answer", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: ACTION_ID,
          max_length: MAX_ANSWER_LENGTH,
          ...(pendingAnswer !== undefined ? { initial_value: pendingAnswer } : {}),
          placeholder: { type: "plain_text", text: "Type your answer", emoji: true },
        },
        hint: {
          type: "plain_text",
          text: "You can re-open this modal and edit your answer until the reveal.",
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
