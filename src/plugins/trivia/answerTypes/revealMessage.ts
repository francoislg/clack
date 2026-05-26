/**
 * Slack-side I/O for reveal-time question lookups: parsing the stored
 * `messageLink` into a (channel, ts) pair and fetching the message's
 * reactions. Both return structured outcomes the handler can propagate to
 * the reveal flow as `{ ok: false, error }` instead of throwing.
 */

import type { TriviaQuestion } from "../core/types.js";
import { parseChannelFromPermalink, parseTsFromPermalink } from "../tools/reveal/slack.js";
import type { SlackReactionLike } from "../tools/reveal/types.js";
import type { ProcessRevealDeps } from "./types.js";

/**
 * Parse the Slack message coordinates from a question's stored `messageLink`.
 * Returns the parsed pair on success, or a `{ error }` sibling the caller
 * propagates as a `ProcessRevealOutcome` error.
 */
export function parseMessageCoordinates(
  question: TriviaQuestion,
): { channel: string; ts: string } | { error: string } {
  if (!question.postedAt || !question.messageLink) {
    return { error: "question is missing postedAt/messageLink" };
  }
  const ts = parseTsFromPermalink(question.messageLink);
  const channel = parseChannelFromPermalink(question.messageLink);
  if (ts === null || channel === null) {
    return {
      error: `could not parse Slack ts/channel from messageLink: ${question.messageLink}`,
    };
  }
  return { channel, ts };
}

/**
 * Fetch the question message's reactions, mapping errors to a structured
 * outcome the handler can return up to the reveal flow.
 */
export async function fetchQuestionReactions(
  channel: string,
  ts: string,
  deps: ProcessRevealDeps,
): Promise<SlackReactionLike[] | { error: string }> {
  try {
    return await deps.fetchMessageReactions(channel, ts);
  } catch (err) {
    return {
      error: `failed to fetch Slack message: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
