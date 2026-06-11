import type { KnownBlock } from "@slack/types";

/**
 * `block_id` prefixes of the answer-affordance block appended by `post_questions`
 * (vote buttons for boolean/choice, the Answer button for freeform — plus any hint
 * button sharing that block). The single source of truth for "which block is the
 * answer affordance," used wherever a card is rebuilt without its buttons (reveal
 * edit and lock edit).
 */
export const ANSWER_ACTIONS_BLOCK_PREFIXES = ["vote-actions:", "freeform-answer-actions:"] as const;

/** Return `blocks` with the answer-actions block removed (matched by `block_id` prefix). */
export function stripAnswerButtons(blocks: readonly KnownBlock[]): KnownBlock[] {
  return blocks.filter((block) => {
    const id = block.block_id ?? "";
    return !ANSWER_ACTIONS_BLOCK_PREFIXES.some((prefix) => id.startsWith(prefix));
  });
}
