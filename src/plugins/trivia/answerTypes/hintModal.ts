import type { ModalView } from "@slack/web-api";
import type { ClackSdk } from "../../sdk.js";
import type { TriviaQuestion } from "../core/types.js";

export interface BuildHintModalParams {
  /**
   * The question the hint belongs to. May be `undefined` when the record could
   * not be resolved (stale message / deleted game) — the modal then renders the
   * "no hint available" fallback with no statement.
   */
  question?: TriviaQuestion;
  t: ClackSdk["t"];
}

/**
 * Build the Slack modal shown when a user clicks the "💡 Get Hint!" button.
 *
 * The view is DISPLAY-ONLY: it carries a Close button and NO submit button, so
 * Slack never emits a `view_submission` event and no view handler is registered.
 * When the question has a hint, the body shows the question statement followed by
 * the hint line; otherwise it shows the localized "no hint available" message.
 */
export function buildHintModal({ question, t }: BuildHintModalParams): ModalView {
  const blocks: ModalView["blocks"] = [];

  if (question !== undefined) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: question.statement } });
  }

  const hint = question?.hint;
  if (hint !== undefined) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: t("hint.ephemeral_prefix", { text: hint.text }) },
    });
  } else {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: t("hint.missing") } });
  }

  return {
    type: "modal",
    title: { type: "plain_text", text: t("hint.modal_title"), emoji: true },
    close: { type: "plain_text", text: t("modal.close"), emoji: true },
    blocks,
  };
}
