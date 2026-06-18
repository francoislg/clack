import { z } from "zod";
import type {
  DividerBlock,
  HeaderBlock,
  SectionBlock,
  ContextBlock,
  MarkdownBlock,
  PlainTextElement,
  TableBlock,
  RawTextElement,
  CardBlock,
  CarouselBlock,
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

// Reference to a stored Slack file by `id` or `url` (its `url_private`/`permalink`).
// Renders a private file inline without a public URL. The exactly-one-of-id/url rule
// lives in `validateImage` so the error is actionable.
const slackFileSchema = z.looseObject({
  id: z.string().optional(),
  url: z.string().optional(),
});

// An image is either a public `image_url` or a `slack_file` reference; both optional
// here so either variant parses, with the one-of rule enforced in `validateImage`.
const imageBlockSchema = z.looseObject({
  type: z.literal("image"),
  image_url: z.string().optional(),
  slack_file: slackFileSchema.optional(),
  alt_text: z.string(),
  title: plainTextSchema.optional(),
});

// Markdown block: full GitHub-flavored markdown rendered server-side. See
// design.md decision (2): passthrough preparer, cumulative 12k-char cap
// enforced at validation time.
const markdownBlockSchema = z.looseObject({
  type: z.literal("markdown"),
  text: z.string().min(1),
});

// ----------------------------------------------------------------------------
// Table block — cells are RawTextElement or RichTextBlock (per @slack/types)
// ----------------------------------------------------------------------------
// Authoring sugar: a bare string in a cell position is auto-wrapped as
// `{ type: "raw_text", text }` during prepareBlocks.

const tableRawTextCellSchema = z.looseObject({
  type: z.literal("raw_text"),
  text: z.string(),
});

// rich_text cell elements have many subtypes (sections, lists, quotes,
// preformatted, with styled spans / links / mentions / emoji). We don't
// validate them deeply — server-side rendering enforces shape — we just
// require each element to be a tagged object so basic typos surface here.
// `z.custom` cannot be serialized to JSON Schema (Zod v4 throws), which
// breaks the agent SDK's `tools/list` handler and silently drops the
// entire Clack tool registry. `z.looseObject` is the JSON-Schema-safe
// equivalent that still requires a `type` tag.
const richTextElementSchema = z.looseObject({
  type: z.string(),
});

const tableRichTextCellSchema = z.looseObject({
  type: z.literal("rich_text"),
  elements: z.array(richTextElementSchema),
});

const tableCellSchema = z.union([z.string(), tableRawTextCellSchema, tableRichTextCellSchema]);

const tableColumnSettingSchema = z.looseObject({
  align: z.enum(["left", "center", "right"]).optional(),
  is_wrapped: z.boolean().optional(),
});

/**
 * Standalone schema for the top-level `table` parameter on `submit_response`
 * and `post_to`. Tables are NOT members of the curated `Block` union — Slack
 * always renders them at the bottom of the message regardless of position in
 * `blocks`, and rejects payloads with more than one. The MCP-tool surface
 * encodes both constraints structurally by exposing tables as a sibling
 * parameter (single optional field) rather than a block type.
 */
export const tableBlockSchema = z.looseObject({
  type: z.literal("table"),
  rows: z.array(z.array(tableCellSchema)).min(1),
  column_settings: z.array(tableColumnSettingSchema).optional(),
});

// ----------------------------------------------------------------------------
// Card and Carousel blocks
// ----------------------------------------------------------------------------
// Slack's card / carousel block types — newer Block Kit additions for entity
// summaries (PR cards, repo cards, etc). Clack's v1 disallows the card-level
// `actions` field — interactive buttons go through the top-level
// `actions: Action[]` field on `submit_response`. `@slack/types`'s `CardBlock`
// permits `actions`, so the Zod schema below accepts it as a passthrough and
// `validateCard` rejects it at validation time. See design.md for
// `add-card-and-carousel-blocks`.

const cardImageObjectSchema = z.looseObject({
  type: z.literal("image"),
  image_url: z.string(),
  alt_text: z.string(),
});

// Card schema. `looseObject` lets the `actions` field pass through Zod parse;
// `validateCard` rejects its presence at validation time with an actionable
// error. We deliberately don't use `.refine()` here because wrapping a
// discriminated-union member in a refine breaks Zod's narrowing (the variant
// becomes a `ZodPipe` rather than a `ZodObject`).
const cardBlockSchema = z.looseObject({
  type: z.literal("card"),
  hero_image: cardImageObjectSchema.optional(),
  icon: cardImageObjectSchema.optional(),
  title: mrkdwnTextSchema.optional(),
  subtitle: mrkdwnTextSchema.optional(),
  body: mrkdwnTextSchema.optional(),
});

const carouselBlockSchema = z.looseObject({
  type: z.literal("carousel"),
  // Carousel children are validated as cards by both the Zod schema and
  // `validateCarousel` (which delegates to `validateCard` per child).
  elements: z
    .array(
      z.looseObject({
        type: z.literal("card"),
        hero_image: cardImageObjectSchema.optional(),
        icon: cardImageObjectSchema.optional(),
        title: mrkdwnTextSchema.optional(),
        subtitle: mrkdwnTextSchema.optional(),
        body: mrkdwnTextSchema.optional(),
      }),
    )
    .min(1)
    .max(10),
});

/**
 * Runtime validator for the curated Slack Block Kit subset Claude may author
 * inside the `blocks` array on `submit_response` and `post_to` actions.
 *
 * Explicitly NOT included: `actions` (driven by the structured
 * `actions: Action[]` field on `submit_response`, not authored in `blocks`),
 * and non-message block types like `input`, `rich_text` (top-level — note
 * that rich_text appears as a CELL type inside `table`), `file`, `video`,
 * `alert`, `card`, `carousel`, `context_actions`, `plan`, `task_card`.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface MaybeTaggedInput {
  type?: JsonValue;
}

function readTypeTag(input: JsonValue | undefined): JsonValue | undefined {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return (input as MaybeTaggedInput).type;
  }
  return undefined;
}

// Custom error message for unknown block types — makes the Zod error
// actionable at the source (names the offending type and lists allowed
// types) so the model doesn't have to infer what went wrong from a generic
// "Invalid input" message. The discriminated-union variants below still
// own their own per-field errors via standard Zod messages.
export const BlockSchema = z.discriminatedUnion(
  "type",
  [
    dividerBlockSchema,
    headerBlockSchema,
    sectionBlockSchema,
    contextBlockSchema,
    imageBlockSchema,
    markdownBlockSchema,
    cardBlockSchema,
    carouselBlockSchema,
  ],
  {
    error: (issue) => {
      if (issue.code === "invalid_union") {
        const actualType = readTypeTag(issue.input as JsonValue | undefined);
        if (actualType === "table") {
          return 'Block type "table" is not a member of `blocks` — it is a top-level sibling parameter on `submit_response` (and on each `post_to` action). Move the table object to the `table` field next to `blocks`.';
        }
        const allowed = ALLOWED_BLOCK_TYPES.join(", ");
        return `Block type ${JSON.stringify(actualType)} is not supported. Allowed block types: ${allowed}.`;
      }
      return undefined;
    },
  },
);

/**
 * Rich-text cell elements: each element must be a tagged object. We don't
 * encode Slack's full RichTextBlockElement schema here — Slack enforces it
 * server-side. The wider shape matches the Zod looseObject parse output and
 * keeps JSON Schema generation MCP-friendly.
 */
export interface AuthoredRichTextElement {
  type: string;
}

/** Rich-text cell variant of an authored table cell. */
export interface AuthoredRichTextCell {
  type: "rich_text";
  elements: AuthoredRichTextElement[];
}

/**
 * Authoring-time table cell shape: bare strings are sugar for raw_text and
 * are normalized into RawTextElement during prepareBlocks.
 */
export type AuthoredTableCell = string | RawTextElement | AuthoredRichTextCell;

/**
 * Table block as Claude may author it, before prepareBlocks normalizes
 * bare-string cells. Slack's own TableBlock has the narrower post-prep shape.
 */
export type AuthoredTableBlock = Omit<TableBlock, "rows"> & {
  rows: AuthoredTableCell[][];
};

/**
 * Image block as Claude may author it: an `image_url` OR a `slack_file`
 * reference. Slack's own `ImageBlock` models that as a strict url-XOR-slack_file
 * union, but the curated zod schema keeps both fields optional and defers the
 * one-of rule to `validateImage`, so we mirror that looser shape here (the same
 * authored-vs-Slack split as `AuthoredTableBlock`).
 */
export interface AuthoredImageBlock {
  type: "image";
  image_url?: string;
  slack_file?: { id?: string; url?: string };
  alt_text: string;
  title?: PlainTextElement;
  block_id?: string;
}

/**
 * The curated subset of Slack Block Kit blocks Claude may author inside
 * `blocks`. Types are Slack's own — the Zod schema above validates runtime
 * shape. Tables are deliberately NOT members of this union: see
 * `tableBlockSchema` and `AuthoredTableBlock` for the standalone parameter.
 */
export type Block =
  | DividerBlock
  | HeaderBlock
  | SectionBlock
  | ContextBlock
  | AuthoredImageBlock
  | MarkdownBlock
  | CardBlock
  | CarouselBlock;

/** The curated type names as a runtime list — useful for error messages. */
export const ALLOWED_BLOCK_TYPES = [
  "divider",
  "header",
  "section",
  "context",
  "image",
  "markdown",
  "card",
  "carousel",
] as const;
