import type { Block, AuthoredTableCell } from "./blockSchema.js";

// ============================================================================
// Slack Block Kit limits
// ============================================================================

const HEADER_TEXT_LIMIT = 150;
const CONTEXT_MAX_ELEMENTS = 10;
const CONTEXT_TEXT_LIMIT = 75;
const SECTION_TEXT_LIMIT = 3000;
const SECTION_FIELDS_MIN = 2;
const SECTION_FIELDS_MAX = 10;
const SECTION_FIELD_TEXT_LIMIT = 2000;
const TOTAL_BLOCKS_LIMIT = 50;
// Slack documents a 12,000-char cap across all markdown blocks per payload.
const MARKDOWN_CUMULATIVE_TEXT_LIMIT = 12_000;
// Slack table block constraints.
const TABLE_MAX_ROWS = 100;
const TABLE_MAX_CELLS_PER_ROW = 20;
const TABLE_MAX_COLUMN_SETTINGS = 20;
// Per-cell text cap (Slack does not publish a hard limit; mirroring the
// section-field cap as a conservative starting point).
const TABLE_CELL_TEXT_LIMIT = 2000;

export interface BlockValidationError {
  field: string;
  message: string;
  currentLength: number;
  limit: number;
}

// ============================================================================
// Per-type validators
// ============================================================================

function validateHeader(
  block: Extract<Block, { type: "header" }>,
  i: number,
): BlockValidationError[] {
  const text = block.text.text;
  if (text.length <= HEADER_TEXT_LIMIT) return [];
  return [
    {
      field: `blocks[${i}].text.text`,
      message: `blocks[${i}] (header) text.text (${text.length} chars) exceeds the ${HEADER_TEXT_LIMIT}-char limit. Shorten the header.`,
      currentLength: text.length,
      limit: HEADER_TEXT_LIMIT,
    },
  ];
}

function validateContext(
  block: Extract<Block, { type: "context" }>,
  i: number,
): BlockValidationError[] {
  const errors: BlockValidationError[] = [];
  const elements = block.elements;

  if (elements.length > CONTEXT_MAX_ELEMENTS) {
    errors.push({
      field: `blocks[${i}].elements`,
      message: `blocks[${i}] (context) has ${elements.length} elements, exceeding the ${CONTEXT_MAX_ELEMENTS}-element limit.`,
      currentLength: elements.length,
      limit: CONTEXT_MAX_ELEMENTS,
    });
  }

  elements.forEach((el, ei) => {
    if (el.type === "plain_text" || el.type === "mrkdwn") {
      const txt = el.text;
      if (txt.length > CONTEXT_TEXT_LIMIT) {
        errors.push({
          field: `blocks[${i}].elements[${ei}].text`,
          message: `blocks[${i}] (context) element[${ei}] text (${txt.length} chars) exceeds the ${CONTEXT_TEXT_LIMIT}-char limit.`,
          currentLength: txt.length,
          limit: CONTEXT_TEXT_LIMIT,
        });
      }
    }
  });

  return errors;
}

function validateSection(
  block: Extract<Block, { type: "section" }>,
  i: number,
): BlockValidationError[] {
  const errors: BlockValidationError[] = [];
  const text = block.text?.text ?? "";

  if (text.length > SECTION_TEXT_LIMIT) {
    errors.push({
      field: `blocks[${i}].text.text`,
      message: `blocks[${i}] (section) text.text (${text.length} chars) exceeds the ${SECTION_TEXT_LIMIT}-char limit. prepareBlocks should have split this — if you see this error, the text could not be split (e.g., an unbreakable single token).`,
      currentLength: text.length,
      limit: SECTION_TEXT_LIMIT,
    });
  }

  const fields = block.fields;
  if (fields !== undefined) {
    if (fields.length < SECTION_FIELDS_MIN || fields.length > SECTION_FIELDS_MAX) {
      errors.push({
        field: `blocks[${i}].fields`,
        message: `blocks[${i}] (section) has ${fields.length} fields — must be between ${SECTION_FIELDS_MIN} and ${SECTION_FIELDS_MAX} inclusive.`,
        currentLength: fields.length,
        limit: SECTION_FIELDS_MAX,
      });
    }
    fields.forEach((f, fi) => {
      const ft = f.text;
      if (ft.length > SECTION_FIELD_TEXT_LIMIT) {
        errors.push({
          field: `blocks[${i}].fields[${fi}].text`,
          message: `blocks[${i}] (section) fields[${fi}] text (${ft.length} chars) exceeds the ${SECTION_FIELD_TEXT_LIMIT}-char limit.`,
          currentLength: ft.length,
          limit: SECTION_FIELD_TEXT_LIMIT,
        });
      }
    });
  }

  if (block.text === undefined && fields === undefined) {
    errors.push({
      field: `blocks[${i}]`,
      message: `blocks[${i}] (section) must have either a \`text\` field or a \`fields\` array.`,
      currentLength: 0,
      limit: 0,
    });
  }

  return errors;
}

// ----------------------------------------------------------------------------
// Markdown — per-block has nothing to validate beyond the schema parse; the
// 12k cumulative cap is enforced as a payload-scope check inside validateBlocks.
// ----------------------------------------------------------------------------

/**
 * Length of a table cell's plain text. For string and raw_text cells the
 * length is the rendered text. For rich_text cells we return null —
 * walking Slack's rich_text element tree to sum text would require
 * encoding its full schema here, which we explicitly chose not to. The
 * per-cell text cap is only enforced where measurement is straightforward.
 */
function tableCellTextLength(cell: AuthoredTableCell): number | null {
  if (typeof cell === "string") return cell.length;
  if (cell.type === "raw_text") return cell.text.length;
  return null;
}

function validateTable(
  block: Extract<Block, { type: "table" }>,
  i: number,
): BlockValidationError[] {
  const errors: BlockValidationError[] = [];
  const rows = block.rows;

  if (rows.length > TABLE_MAX_ROWS) {
    errors.push({
      field: `blocks[${i}].rows`,
      message: `blocks[${i}] (table) has ${rows.length} rows, exceeding the ${TABLE_MAX_ROWS}-row limit. Reduce row count or split tabular data into a markdown table inside a markdown block (no row cap).`,
      currentLength: rows.length,
      limit: TABLE_MAX_ROWS,
    });
  }

  rows.forEach((row, ri) => {
    if (row.length > TABLE_MAX_CELLS_PER_ROW) {
      errors.push({
        field: `blocks[${i}].rows[${ri}]`,
        message: `blocks[${i}] (table) row ${ri} has ${row.length} cells, exceeding the ${TABLE_MAX_CELLS_PER_ROW}-cell limit.`,
        currentLength: row.length,
        limit: TABLE_MAX_CELLS_PER_ROW,
      });
    }
    row.forEach((cell, ci) => {
      const len = tableCellTextLength(cell);
      if (len !== null && len > TABLE_CELL_TEXT_LIMIT) {
        errors.push({
          field: `blocks[${i}].rows[${ri}][${ci}]`,
          message: `blocks[${i}] (table) cell at row ${ri}, column ${ci} has ${len} chars of text, exceeding the ${TABLE_CELL_TEXT_LIMIT}-char limit. Shorten the cell or move large content into a separate block.`,
          currentLength: len,
          limit: TABLE_CELL_TEXT_LIMIT,
        });
      }
    });
  });

  if (block.column_settings && block.column_settings.length > TABLE_MAX_COLUMN_SETTINGS) {
    errors.push({
      field: `blocks[${i}].column_settings`,
      message: `blocks[${i}] (table) column_settings has ${block.column_settings.length} entries, exceeding the ${TABLE_MAX_COLUMN_SETTINGS}-entry limit.`,
      currentLength: block.column_settings.length,
      limit: TABLE_MAX_COLUMN_SETTINGS,
    });
  }

  return errors;
}

// Fields Slack accepts on an image block. Anything else triggers
// `ignored_extra_attributes_for_image_block` warnings server-side, so we reject
// them here and hand Claude an actionable error instead.
const ALLOWED_IMAGE_KEYS = new Set(["type", "image_url", "alt_text", "title", "block_id"]);

function validateImage(
  block: Extract<Block, { type: "image" }>,
  i: number,
): BlockValidationError[] {
  const errors: BlockValidationError[] = [];
  // Our curated subset only accepts URL-based images (not slack_file references),
  // so we narrow to the UrlImageObject variant via `in`.
  if ("image_url" in block) {
    if (block.image_url.length === 0) {
      errors.push({
        field: `blocks[${i}].image_url`,
        message: `blocks[${i}] (image) requires a non-empty \`image_url\`.`,
        currentLength: 0,
        limit: 0,
      });
    }
  } else {
    errors.push({
      field: `blocks[${i}].image_url`,
      message: `blocks[${i}] (image) is missing \`image_url\`. Our curated subset requires a URL-based image.`,
      currentLength: 0,
      limit: 0,
    });
  }
  if (block.alt_text.length === 0) {
    errors.push({
      field: `blocks[${i}].alt_text`,
      message: `blocks[${i}] (image) requires a non-empty \`alt_text\` for accessibility.`,
      currentLength: 0,
      limit: 0,
    });
  }

  const extras = Object.keys(block).filter((k) => !ALLOWED_IMAGE_KEYS.has(k));
  if (extras.length > 0) {
    errors.push({
      field: `blocks[${i}]`,
      message: `blocks[${i}] (image) has unsupported field(s): ${extras.map((k) => `\`${k}\``).join(", ")}. Slack logs an \`ignored_extra_attributes_for_image_block\` warning for these — remove them. Allowed fields: \`type\`, \`image_url\`, \`alt_text\`, \`title\`, \`block_id\`.`,
      currentLength: extras.length,
      limit: 0,
    });
  }

  return errors;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validate a Claude-authored blocks array (already parsed via BlockSchema)
 * against Slack's per-block limits. Designed to be called AFTER `prepareBlocks`
 * has split oversize sections AND AFTER action-button blocks have been
 * appended — so the total-block-count check reflects the final delivered
 * message.
 *
 * Returns an empty array on success, or a list of per-violation errors with
 * Claude-actionable messages (block index, field path, current length, limit).
 */
export function validateBlocks(blocks: readonly Block[]): BlockValidationError[] {
  const errors: BlockValidationError[] = [];

  if (blocks.length > TOTAL_BLOCKS_LIMIT) {
    errors.push({
      field: "blocks",
      message: `Total block count (${blocks.length}) exceeds the ${TOTAL_BLOCKS_LIMIT}-block limit. Reduce the number of blocks (note: this count includes appended action-button blocks).`,
      currentLength: blocks.length,
      limit: TOTAL_BLOCKS_LIMIT,
    });
  }

  // Payload-scope: Slack rejects payloads with more than one table block
  // (`invalid_attachments`). Surface this here before the API call.
  const tableIndices: number[] = [];
  // Payload-scope: cumulative markdown text across all `markdown` blocks
  // must stay within Slack's documented 12k-char limit.
  let cumulativeMarkdownLength = 0;

  blocks.forEach((block, i) => {
    switch (block.type) {
      case "header":
        errors.push(...validateHeader(block, i));
        break;
      case "context":
        errors.push(...validateContext(block, i));
        break;
      case "section":
        errors.push(...validateSection(block, i));
        break;
      case "image":
        errors.push(...validateImage(block, i));
        break;
      case "markdown":
        cumulativeMarkdownLength += block.text.length;
        break;
      case "table":
        tableIndices.push(i);
        errors.push(...validateTable(block, i));
        break;
      case "divider":
        // Shape-only; nothing to validate beyond the schema parse.
        break;
    }
  });

  if (cumulativeMarkdownLength > MARKDOWN_CUMULATIVE_TEXT_LIMIT) {
    errors.push({
      field: "blocks",
      message: `Cumulative \`markdown\` block text (${cumulativeMarkdownLength} chars across all markdown blocks) exceeds Slack's ${MARKDOWN_CUMULATIVE_TEXT_LIMIT}-char limit. Reduce total markdown content or split across multiple responses.`,
      currentLength: cumulativeMarkdownLength,
      limit: MARKDOWN_CUMULATIVE_TEXT_LIMIT,
    });
  }

  if (tableIndices.length > 1) {
    errors.push({
      field: "blocks",
      message: `Slack allows at most one \`table\` block per message — found ${tableIndices.length} at indices [${tableIndices.join(", ")}]. Use a markdown table inside a \`markdown\` block when multiple tabular sections are needed.`,
      currentLength: tableIndices.length,
      limit: 1,
    });
  }

  return errors;
}
