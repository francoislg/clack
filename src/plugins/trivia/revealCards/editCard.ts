/**
 * Static reveal-time edit of a question's original Slack message. Sibling of
 * `freeform/roster.ts:editRosterIntoCard`, but run ONCE at reveal instead of on
 * every click. Like the roster editor it always rebuilds from the stored
 * `postedBlocks` (never from the message's current Slack state) so repeated
 * edits can't accumulate stale blocks, and every failure path logs and returns
 * rather than throwing back into the reveal flow.
 *
 * The rebuild:
 *   1. drops the answer-actions block (vote / freeform-answer buttons, plus any
 *      hint button sharing that block) by its `block_id` prefix,
 *   2. appends the static results footer (who got it right, per mode),
 *   3. appends a "See your answer" button, and
 *   4. when `tellMeMore` is enabled, appends a "Tell me more" button in its own
 *      actions block (so the click handler can drop just that block).
 */

import type { KnownBlock } from "@slack/types";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import { t } from "../i18n/t.js";
import { getAnswerTypeHandler } from "../answerTypes/registry.js";
import type { TriviaQuestion } from "../core/types.js";
import type { ProcessRevealEntry } from "../tools/reveal/types.js";
import { parseChannelFromPermalink, parseTsFromPermalink } from "../tools/reveal/slack.js";
import { buildRevealFooterBlocks } from "./footer.js";

/** `block_id` prefixes of the answer-affordance block appended by `post_questions`. */
const ANSWER_ACTIONS_BLOCK_PREFIXES = ["vote-actions:", "freeform-answer-actions:"] as const;

export interface EditRevealParams {
  /**
   * Message-update seam (mirrors the reveal tool's `RevealSlackDeps`). Throws
   * are caught here and treated as non-fatal; the caller's payload is unaffected.
   */
  updateMessage: (channel: string, ts: string, blocks: KnownBlock[]) => Promise<void>;
  question: TriviaQuestion;
  entry: ProcessRevealEntry;
  /** Plugin SDK action-id namespacer, e.g. `(key) => \`plugin:trivia:\${key}\``. */
  actionId: (key: string) => string;
  /** When true, append a "Tell me more" button alongside "See your answer". */
  tellMeMore: boolean;
}

/**
 * Repaint a revealed question's card into its final, static state. Skips (with
 * a warning) when the question lacks `postedBlocks` (legacy row) or a parseable
 * `messageLink`; swallows `chat.update` failures.
 */
export async function editRevealIntoCard(params: EditRevealParams): Promise<void> {
  const { updateMessage, question, entry, actionId, tellMeMore } = params;

  if (question.postedBlocks === undefined) {
    logger.warn(
      `[trivia:reveal-card] edit skipped — question ${question.id} has no postedBlocks (legacy row)`,
    );
    return;
  }
  if (!question.messageLink) {
    logger.warn(`[trivia:reveal-card] edit skipped — question ${question.id} has no messageLink`);
    return;
  }
  const ts = parseTsFromPermalink(question.messageLink);
  const channel = parseChannelFromPermalink(question.messageLink);
  if (ts === null || channel === null) {
    logger.warn(
      `[trivia:reveal-card] edit skipped — could not parse ts/channel for question ${question.id}: ${question.messageLink}`,
    );
    return;
  }

  const bodyBlocks = question.postedBlocks.filter((block) => {
    const id = block.block_id ?? "";
    return !ANSWER_ACTIONS_BLOCK_PREFIXES.some((prefix) => id.startsWith(prefix));
  });

  const handler = getAnswerTypeHandler(question.answersFormat);
  const answerLine = handler.formatCorrectAnswer(question);
  const footer = buildRevealFooterBlocks(entry.voters, answerLine, question.id);

  const seeAnswerButton: KnownBlock = {
    type: "actions",
    block_id: `reveal-see-answer-actions:${question.id}`,
    elements: [
      {
        type: "button",
        action_id: actionId(`reveal-see-answer:${question.id}`),
        text: { type: "plain_text", text: t("button.see_your_answer"), emoji: true },
      },
    ],
  };

  // When `includeRevealInQuestions: "yes"`, `update_question` has stored authored
  // narrative on the record; append it BELOW the deterministic facts footer (and
  // above the "See your answer" button). Absent → facts-only, today's behavior.
  const narrativeBlocks = question.revealBlocks ?? [];

  const updatedBlocks: KnownBlock[] = [
    ...bodyBlocks,
    ...footer,
    ...narrativeBlocks,
    seeAnswerButton,
  ];

  if (tellMeMore) {
    updatedBlocks.push({
      type: "actions",
      block_id: `reveal-tell-me-more-actions:${question.id}`,
      elements: [
        {
          type: "button",
          action_id: actionId(`tell-me-more:${question.id}`),
          text: { type: "plain_text", text: t("button.tell_me_more"), emoji: true },
        },
      ],
    });
  }

  try {
    await updateMessage(channel, ts, updatedBlocks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[trivia:reveal-card] chat.update failed for question ${question.id}: ${msg}`);
  }
}
