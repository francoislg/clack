import type { App } from "@slack/bolt";
import type { ContextBlock, DividerBlock, KnownBlock } from "@slack/types";
import { logger } from "../../../logger.js";
import type { ScopedTriviaDataLayer, SubmittedAnswer, TriviaQuestion } from "../core/types.js";
import { parseChannelFromPermalink, parseTsFromPermalink } from "../tools/reveal/slack.js";

/**
 * Dedupe by userId (keeping each user's max timestamp) and sort newest-first.
 * Editing an answer re-stamps `timestamp`, so the editor floats to the top —
 * that's the visual confirmation the modal-submit flow relies on.
 */
export function orderedRosterUserIds(answers: SubmittedAnswer[]): string[] {
  const maxByUser = new Map<string, number>();
  for (const a of answers) {
    const prev = maxByUser.get(a.userId);
    if (prev === undefined || a.timestamp > prev) {
      maxByUser.set(a.userId, a.timestamp);
    }
  }
  return [...maxByUser.entries()].sort((a, b) => b[1] - a[1]).map(([userId]) => userId);
}

export function buildRosterBlock(orderedUserIds: string[], questionId: string): ContextBlock {
  const text =
    orderedUserIds.length === 0
      ? "📝 *Answered:* (no answers yet)"
      : "📝 *Answered:* " + orderedUserIds.map((id) => `<@${id}>`).join(", ");
  return {
    type: "context",
    block_id: `freeform-answered-roster:${questionId}`,
    elements: [{ type: "mrkdwn", text }],
  };
}

function buildRosterDivider(questionId: string): DividerBlock {
  return {
    type: "divider",
    block_id: `freeform-answered-divider:${questionId}`,
  };
}

export interface EditRosterParams {
  client: App["client"];
  scoped: ScopedTriviaDataLayer;
  question: TriviaQuestion;
}

/**
 * Repaint the question card with the latest answered-roster footer. Caller
 * already ack'd the modal submission, so every failure path here just logs
 * and returns — never throws back into the handler.
 */
export async function editRosterIntoCard(params: EditRosterParams): Promise<void> {
  const { client, scoped, question } = params;

  if (question.postedBlocks === undefined) {
    logger.warn(
      `[trivia:freeform] roster edit skipped — question ${question.id} has no postedBlocks (legacy row)`,
    );
    return;
  }
  if (!question.messageLink) {
    logger.warn(
      `[trivia:freeform] roster edit skipped — question ${question.id} has no messageLink`,
    );
    return;
  }
  const ts = parseTsFromPermalink(question.messageLink);
  const channel = parseChannelFromPermalink(question.messageLink);
  if (ts === null || channel === null) {
    logger.warn(
      `[trivia:freeform] roster edit skipped — could not parse ts/channel for question ${question.id}: ${question.messageLink}`,
    );
    return;
  }

  const allAnswers = await scoped.loadAnswers();
  const forThisQuestion = allAnswers.filter((a) => a.questionId === question.id);
  const userIds = orderedRosterUserIds(forThisQuestion);

  // Always rebuild from postedBlocks — never from the current Slack state — so
  // edits can't accumulate stale roster blocks.
  const updatedBlocks: KnownBlock[] = [
    ...question.postedBlocks,
    buildRosterDivider(question.id),
    buildRosterBlock(userIds, question.id),
  ];

  try {
    await client.chat.update({ channel, ts, blocks: updatedBlocks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[trivia:freeform] roster chat.update failed for question ${question.id}: ${msg}`);
  }
}
