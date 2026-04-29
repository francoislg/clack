import { z } from "zod";
import type {
  DividerBlock,
  HeaderBlock,
  SectionBlock,
  ContextBlock,
  ImageBlock,
  MarkdownBlock,
  TableBlock,
  RawTextElement,
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

const tableBlockSchema = z.looseObject({
  type: z.literal("table"),
  rows: z.array(z.array(tableCellSchema)).min(1),
  column_settings: z.array(tableColumnSettingSchema).optional(),
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
    tableBlockSchema,
  ],
  {
    error: (issue) => {
      if (issue.code === "invalid_union") {
        const actualType = readTypeTag(issue.input as JsonValue | undefined);
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
 * The curated subset of Slack Block Kit blocks Claude may author.
 * Types are Slack's own — the Zod schema above validates runtime shape.
 * Tables use AuthoredTableBlock to admit string-cell sugar; prepareTable
 * narrows cells to RawTextElement | RichTextBlock at runtime.
 */
export type Block =
  | DividerBlock
  | HeaderBlock
  | SectionBlock
  | ContextBlock
  | ImageBlock
  | MarkdownBlock
  | AuthoredTableBlock;

/** The curated type names as a runtime list — useful for error messages. */
export const ALLOWED_BLOCK_TYPES = [
  "divider",
  "header",
  "section",
  "context",
  "image",
  "markdown",
  "table",
] as const;
