import type { ContextBlock, KnownBlock } from "@slack/types";
import type { SlackBlocks } from "../../../../slack/blocks.js";
import type { TriviaQuestion } from "../../core/types.js";
import type { ClackSdk } from "../../../sdk.js";
import { insertBeforeActions, mrkdwnContext } from "./cardLayout.js";

/**
 * Marks the worth line on a stored card so `override_question` can find it again
 * without pattern-matching localized text.
 */
export const WORTH_BLOCK_ID = "trivia_points_worth";

function worthBlock(points: number, sdk: Pick<ClackSdk, "t">): ContextBlock {
  return { ...mrkdwnContext(sdk.t("points.worth", { count: points })), block_id: WORTH_BLOCK_ID };
}

/**
 * Render the "⭐ Worth N points" line for a question worth more than 1, directly
 * above the answer affordances.
 *
 * Built from the question record's STAMPED `points` — never from live config — so
 * the card can't promise stakes that differ from what scoring will pay out. Runs
 * before hint rendering, so an inline hint stays adjacent to the buttons.
 *
 * Questions worth 1 (stamped absent) return the input unchanged, which is what
 * keeps pre-feature cards byte-identical.
 */
export function applyPointsRendering(
  blocks: SlackBlocks,
  question: TriviaQuestion,
  sdk: Pick<ClackSdk, "t">,
): SlackBlocks {
  const points = question.points ?? 1;
  if (points <= 1) return blocks;
  return insertBeforeActions(blocks, worthBlock(points, sdk));
}

/**
 * Re-point an already-posted card's stored blocks: replace the worth line, insert
 * one (when a 1-point question is promoted), or drop it (when demoted back to 1).
 *
 * Operates on `postedBlocks` because that — not the live Slack message — is what
 * every card rebuild composes from; leaving it stale would let the next roster
 * rebuild resurrect the old value.
 */
export function rewriteWorthBlock(
  blocks: readonly KnownBlock[],
  points: number,
  sdk: Pick<ClackSdk, "t">,
): KnownBlock[] {
  const without = blocks.filter((b) => b.block_id !== WORTH_BLOCK_ID);
  if (points <= 1) return without;
  return insertBeforeActions(without, worthBlock(points, sdk));
}
