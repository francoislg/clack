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
 *   2. appends the static results footer (who got it right, per mode), and
 *   3. appends the post-game buttons (`renderPostGameButtons`) — every enabled
 *      registry entry as an element of one shared actions block (single row).
 */

import type { KnownBlock } from "@slack/types";
import { triviaLogger as logger } from "../core/pluginLogger.js";
import { getAnswerTypeHandler } from "../answerTypes/registry.js";
import { t } from "../i18n/t.js";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import type { TriviaQuestion } from "../core/types.js";
import type { ProcessRevealEntry } from "../tools/reveal/types.js";
import { parseChannelFromPermalink, parseTsFromPermalink } from "../tools/reveal/slack.js";
import { buildRevealFooterBlocks } from "./footer.js";
import { renderPostGameButtons } from "./postGameButtons.js";
import { POST_GAME_BUTTONS } from "./postGameRegistry.js";
import { stripAnswerButtons } from "./answerActions.js";

/**
 * Resolve the `chat.update` target for a card repaint: the channel + ts from the
 * stored `messageLink`, and the body blocks (the stored `postedBlocks` minus the
 * answer-affordance block). Returns null (after logging) for a legacy row without
 * `postedBlocks`/`messageLink` or an unparseable link. Shared by the reveal-results
 * and invalidated repaints.
 */
function resolveCardTarget(
  question: TriviaQuestion,
): { channel: string; ts: string; bodyBlocks: KnownBlock[] } | null {
  if (question.postedBlocks === undefined) {
    logger.warn(
      `[trivia:reveal-card] edit skipped — question ${question.id} has no postedBlocks (legacy row)`,
    );
    return null;
  }
  if (!question.messageLink) {
    logger.warn(`[trivia:reveal-card] edit skipped — question ${question.id} has no messageLink`);
    return null;
  }
  const ts = parseTsFromPermalink(question.messageLink);
  const channel = parseChannelFromPermalink(question.messageLink);
  if (ts === null || channel === null) {
    logger.warn(
      `[trivia:reveal-card] edit skipped — could not parse ts/channel for question ${question.id}: ${question.messageLink}`,
    );
    return null;
  }
  const bodyBlocks = stripAnswerButtons(question.postedBlocks);
  return { channel, ts, bodyBlocks };
}

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
  /** Owning game + workspace config, used to resolve per-button enablement (e.g. `tellMeMore`). */
  game: TriviaGame | null;
  config: TriviaConfig | null;
}

/**
 * Repaint a revealed question's card into its final, static state. Skips (with
 * a warning) when the question lacks `postedBlocks` (legacy row) or a parseable
 * `messageLink`; swallows `chat.update` failures.
 */
export async function editRevealIntoCard(params: EditRevealParams): Promise<void> {
  const { updateMessage, question, entry, actionId, game, config } = params;

  const target = resolveCardTarget(question);
  if (target === null) return;
  const { channel, ts, bodyBlocks } = target;

  const handler = getAnswerTypeHandler(question.answersFormat);
  const answerLine = handler.formatCorrectAnswer(question);
  const footer = buildRevealFooterBlocks(
    entry.voters,
    answerLine,
    question.id,
    question.tagPlayers ?? true,
  );

  // When `includeRevealInQuestions: "yes"`, `update_question` has stored authored
  // narrative on the record; append it BELOW the deterministic facts footer (and
  // above the post-game buttons). Absent → facts-only, today's behavior.
  const narrativeBlocks = question.revealBlocks ?? [];

  const postGameButtons = renderPostGameButtons(
    POST_GAME_BUTTONS,
    { question, game, config },
    actionId,
  );

  const updatedBlocks: KnownBlock[] = [
    ...bodyBlocks,
    ...footer,
    ...narrativeBlocks,
    ...postGameButtons,
  ];

  try {
    await updateMessage(channel, ts, updatedBlocks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[trivia:reveal-card] chat.update failed for question ${question.id}: ${msg}`);
  }
}

/**
 * Repaint an INVALIDATED question's card: drop the answer buttons and append a single
 * "invalidated" context line (with the reason). No results footer, no post-game buttons —
 * the question scored 0 and has no result. Used by `update_answers_block` for any question
 * carrying `invalidated: true`, whether invalidated before or after its reveal.
 */
export async function editInvalidatedIntoCard(params: {
  updateMessage: (channel: string, ts: string, blocks: KnownBlock[]) => Promise<void>;
  question: TriviaQuestion;
}): Promise<void> {
  const { updateMessage, question } = params;
  const target = resolveCardTarget(question);
  if (target === null) return;

  const reason = question.invalidatedReason ?? "";
  const footer: KnownBlock[] = [
    { type: "context", elements: [{ type: "mrkdwn", text: t("reveal.invalidated", { reason }) }] },
  ];
  try {
    await updateMessage(target.channel, target.ts, [...target.bodyBlocks, ...footer]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[trivia:reveal-card] invalidated chat.update failed for ${question.id}: ${msg}`);
  }
}
