import { z } from "zod";
import type {
  DividerBlock,
  HeaderBlock,
  SectionBlock,
  ContextBlock,
  ImageBlock,
} from "@slack/types";

// ============================================================================
// Text object shapes (plain_text / mrkdwn)
// ============================================================================
// Loose objects so optional Slack fields (verbatim, emoji, etc.) carry through.

const plainTextSchema = z.looseObject({
  type: z.literal("plain_text"),
  text: z.string(),
  emoji: z.boolean().optional(),
});

const mrkdwnTextSchema = z.looseObject({
  type: z.literal("mrkdwn"),
  text: z.string(),
  verbatim: z.boolean().optional(),
});

const sectionTextSchema = z.union([plainTextSchema, mrkdwnTextSchema]);

// Image element that can appear inside a context block's elements array.
const contextImageElementSchema = z.looseObject({
  type: z.literal("image"),
  image_url: z.string(),
  alt_text: z.string(),
});

const contextElementSchema = z.union([
  plainTextSchema,
  mrkdwnTextSchema,
  contextImageElementSchema,
]);

// ============================================================================
// Curated block schemas
// ============================================================================
// Loose objects so optional Slack fields (block_id, accessibility_label, etc.)
// survive validation unchanged. These are runtime validators; the canonical
// TypeScript types come from @slack/types.

const dividerBlockSchema = z.looseObject({ type: z.literal("divider") });

const headerBlockSchema = z.looseObject({
  type: z.literal("header"),
  text: plainTextSchema,
});

const sectionBlockSchema = z.looseObject({
  type: z.literal("section"),
  text: sectionTextSchema.optional(),
  fields: z.array(sectionTextSchema).optional(),
});

const contextBlockSchema = z.looseObject({
  type: z.literal("context"),
  elements: z.array(contextElementSchema),
});

const imageBlockSchema = z.looseObject({
  type: z.literal("image"),
  image_url: z.string(),
  alt_text: z.string(),
  title: plainTextSchema.optional(),
});

/**
 * Runtime validator for the curated Slack Block Kit subset Claude may author
 * inside the `blocks` array on `submit_response` and `post_to` actions.
 *
 * Explicitly NOT included: `actions` (driven by the structured
 * `actions: Action[]` field on `submit_response`, not authored in `blocks`),
 * and non-message block types like `input`, `rich_text`, `file`, `video`.
 */
export const BlockSchema = z.discriminatedUnion("type", [
  dividerBlockSchema,
  headerBlockSchema,
  sectionBlockSchema,
  contextBlockSchema,
  imageBlockSchema,
]);

/**
 * The curated subset of Slack Block Kit blocks Claude may author.
 * Types are Slack's own — the Zod schema above validates runtime shape.
 */
export type Block = DividerBlock | HeaderBlock | SectionBlock | ContextBlock | ImageBlock;

/** The curated type names as a runtime list — useful for error messages. */
export const ALLOWED_BLOCK_TYPES = ["divider", "header", "section", "context", "image"] as const;
