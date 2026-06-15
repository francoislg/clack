import { z } from "zod";
import { logger } from "../logger.js";
import type { SlackBlocks } from "./blocks.js";

/**
 * Rewrites an action message so a clicked button is removed without removing the
 * whole message — preserving the proposal/prompt text Claude re-reads from thread
 * history, which `delete_original` used to drop.
 */

export interface StripClickedButtonResult {
  blocks: SlackBlocks;
  text?: string;
}

// `looseObject` keeps sibling fields (block_id, etc.) intact when blocks/elements
// are rebuilt after filtering.
const buttonElementSchema = z.looseObject({ action_id: z.string().optional() });

const actionsBlockSchema = z.looseObject({
  type: z.literal("actions"),
  elements: z.array(z.unknown()),
});

const messageBlockSchema = z.looseObject({ type: z.string() });

const inboundMessageSchema = z.object({
  text: z.string().optional(),
  blocks: z.array(messageBlockSchema).optional(),
});

/**
 * Remove the clicked button from its host message's blocks.
 *
 * @returns the rewritten `{ blocks, text }`, or `null` when there is nothing to
 *   rewrite (no parseable blocks, or no clicked `action_id`) — callers MUST
 *   treat `null` as "leave the message untouched", never removing it.
 */
export function stripClickedButton(
  message: unknown,
  clickedActionId: string | undefined,
): StripClickedButtonResult | null {
  if (!clickedActionId) {
    return null;
  }

  const parsed = inboundMessageSchema.safeParse(message);
  if (!parsed.success) {
    logger.warn("stripClickedButton: could not parse interactive message; leaving it untouched");
    return null;
  }

  const { blocks, text } = parsed.data;
  if (!blocks || blocks.length === 0) {
    return null;
  }

  const out: SlackBlocks = [];
  for (const block of blocks) {
    const asActions = actionsBlockSchema.safeParse(block);
    if (!asActions.success) {
      out.push(block as SlackBlocks[number]);
      continue;
    }

    const remaining = asActions.data.elements.filter((element) => {
      const button = buttonElementSchema.safeParse(element);
      return !(button.success && button.data.action_id === clickedActionId);
    });

    if (remaining.length === 0) {
      // Drop the now-empty actions block and a divider directly above it (the
      // structured renderer prepends `divider, ...actionBlocks`).
      const prev = out[out.length - 1];
      if (prev && prev.type === "divider") {
        out.pop();
      }
      continue;
    }

    out.push({ ...asActions.data, elements: remaining } as SlackBlocks[number]);
  }

  return { blocks: out, ...(text !== undefined && { text }) };
}
