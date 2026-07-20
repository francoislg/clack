import type { ActionsBlock, Button } from "@slack/types";
import type { SlackBlocks } from "../../../../plugins-sdk/sdk.js";
import type { TriviaQuestion } from "../../core/types.js";
import type { ClackSdk } from "../../../../plugins-sdk/sdk.js";
import { insertBeforeActions, isActionsBlock, mrkdwnContext } from "./cardLayout.js";

/**
 * Apply hint rendering to a block list that already has the per-format
 * answer-buttons actions block appended at the end (by
 * `handler.appendActionsBlock`).
 *
 * - `mode === "button"`: append a "💡 Get Hint!" button (action_id
 *   `plugin:trivia:hint:<questionId>`, no `style`) to the END of the final
 *   actions block.
 * - `mode === "inline"`: prepend a `context` block with `💡 _Hint:_ <text>`
 *   immediately BEFORE the final actions block.
 *
 * When the question record has no `hint`, returns the input unchanged.
 */
export function applyHintRendering(
  blocks: SlackBlocks,
  question: TriviaQuestion,
  sdk: Pick<ClackSdk, "t" | "actionId">,
): SlackBlocks {
  if (question.hint === undefined) return blocks;

  if (question.hint.mode === "button") {
    const last = blocks[blocks.length - 1];
    if (!isActionsBlock(last)) return blocks;
    const hintButton: Button = {
      type: "button",
      text: { type: "plain_text", text: sdk.t("button.hint"), emoji: true },
      action_id: sdk.actionId(`hint:${question.id}`),
    };
    const updatedActions: ActionsBlock = {
      ...last,
      elements: [...last.elements, hintButton],
    };
    return [...blocks.slice(0, -1), updatedActions];
  }

  // mode === "inline"
  return insertBeforeActions(
    blocks,
    mrkdwnContext(sdk.t("hint.inline_prefix", { text: question.hint.text })),
  );
}
