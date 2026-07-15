import type { ActionsBlock, ContextBlock } from "@slack/types";

/**
 * Layout primitives shared by the renderers that decorate a question card after
 * `handler.appendActionsBlock` has put the answer buttons at the end.
 */

export function isActionsBlock(block: unknown): block is ActionsBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    "type" in block &&
    (block as { type: unknown }).type === "actions"
  );
}

/** Build a one-element mrkdwn context block. */
export function mrkdwnContext(text: string): ContextBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

/**
 * Slot `block` in immediately before the trailing actions block, or append it
 * when the list doesn't end in one (a card with no answer affordances).
 *
 * Generic in the element type so callers keep their narrower block type (e.g. the
 * `KnownBlock[]` stored on a question record) instead of widening to `SlackBlocks`.
 */
export function insertBeforeActions<T>(
  blocks: readonly T[],
  block: ContextBlock,
): (T | ContextBlock)[] {
  const last = blocks[blocks.length - 1];
  if (isActionsBlock(last)) return [...blocks.slice(0, -1), block, last];
  return [...blocks, block];
}
