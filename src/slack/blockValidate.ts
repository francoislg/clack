import type { AuthoredTableBlock, AuthoredTableCell, Block } from "./blockSchema.js";

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
// Card / Carousel limits per Slack's documented Block Kit shape.
const CARD_TITLE_LIMIT = 150;
const CARD_SUBTITLE_LIMIT = 150;
const CARD_BODY_LIMIT = 200;
const CAROUSEL_MIN_ELEMENTS = 1;
const CAROUSEL_MAX_ELEMENTS = 10;

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

/**
 * Validate the standalone `table` parameter on `submit_response` or `post_to`.
 * `pathPrefix` is used to namespace error field paths for the caller (e.g.,
 * `"table"` for the top-level field, `"actions[2].table"` for a `post_to`
 * action's table). Returns an empty array on success.
 */
export function validateTable(
  block: AuthoredTableBlock,
  pathPrefix: string,
): BlockValidationError[] {
  const errors: BlockValidationError[] = [];
  const rows = block.rows;

  if (rows.length > TABLE_MAX_ROWS) {
    errors.push({
      field: `${pathPrefix}.rows`,
      message: `${pathPrefix} has ${rows.length} rows, exceeding the ${TABLE_MAX_ROWS}-row limit. Reduce row count or split tabular data into a markdown table inside a markdown block (no row cap).`,
      currentLength: rows.length,
      limit: TABLE_MAX_ROWS,
    });
  }

  const firstRowWidth = rows[0]?.length ?? 0;

  rows.forEach((row, ri) => {
    if (row.length > TABLE_MAX_CELLS_PER_ROW) {
      errors.push({
        field: `${pathPrefix}.rows[${ri}]`,
        message: `${pathPrefix} row ${ri} has ${row.length} cells, exceeding the ${TABLE_MAX_CELLS_PER_ROW}-cell limit.`,
        currentLength: row.length,
        limit: TABLE_MAX_CELLS_PER_ROW,
      });
    }
    // Why: Slack renders ragged rows as a visually broken table (cells shift
    // columns, scores misalign with names). The most common authoring mistake
    // is forgetting the empty top-left label cell on row 1 of a 3-row
    // leaderboard. Reject and name the offending row so the model fixes it.
    if (ri > 0 && row.length !== firstRowWidth) {
      errors.push({
        field: `${pathPrefix}.rows[${ri}]`,
        message: `${pathPrefix} row ${ri} has ${row.length} cells but row 0 has ${firstRowWidth}. All rows must have the same number of cells — pad with a single space " " (Slack rejects empty cells) if a header/label cell is missing.`,
        currentLength: row.length,
        limit: firstRowWidth,
      });
    }
    row.forEach((cell, ci) => {
      const len = tableCellTextLength(cell);
      if (len !== null && len > TABLE_CELL_TEXT_LIMIT) {
        errors.push({
          field: `${pathPrefix}.rows[${ri}][${ci}]`,
          message: `${pathPrefix} cell at row ${ri}, column ${ci} has ${len} chars of text, exceeding the ${TABLE_CELL_TEXT_LIMIT}-char limit. Shorten the cell or move large content into a separate block.`,
          currentLength: len,
          limit: TABLE_CELL_TEXT_LIMIT,
        });
      }
      // Why: Slack rejects the entire message with `invalid_blocks` when a
      // raw_text cell has empty text — and a bare-string "" cell is sugar for
      // a raw_text cell, so it falls into the same trap. If you really want
      // a visually blank cell (e.g. the top-left label of a multi-row table),
      // pass a single space " " or a zero-width space "​".
      if (len === 0) {
        errors.push({
          field: `${pathPrefix}.rows[${ri}][${ci}]`,
          message: `${pathPrefix} cell at row ${ri}, column ${ci} has empty text. Slack rejects empty raw_text cells (it returns invalid_blocks for the whole message). If you really want an empty cell, use a single space " " or a zero-width space "\\u200B".`,
          currentLength: 0,
          limit: 1,
        });
      }
    });
  });

  if (block.column_settings) {
    if (block.column_settings.length > TABLE_MAX_COLUMN_SETTINGS) {
      errors.push({
        field: `${pathPrefix}.column_settings`,
        message: `${pathPrefix} column_settings has ${block.column_settings.length} entries, exceeding the ${TABLE_MAX_COLUMN_SETTINGS}-entry limit.`,
        currentLength: block.column_settings.length,
        limit: TABLE_MAX_COLUMN_SETTINGS,
      });
    }
    // Why: Slack pairs column_settings by index; a mismatch silently drops the
    // alignment on extra/missing columns. Fail loudly so the model fixes it.
    if (
      block.column_settings.length !== firstRowWidth &&
      block.column_settings.length <= TABLE_MAX_COLUMN_SETTINGS
    ) {
      errors.push({
        field: `${pathPrefix}.column_settings`,
        message: `${pathPrefix} column_settings has ${block.column_settings.length} entries but the table has ${firstRowWidth} columns. Provide one entry per column or omit column_settings entirely.`,
        currentLength: block.column_settings.length,
        limit: firstRowWidth,
      });
    }
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

// ----------------------------------------------------------------------------
// Card and Carousel
// ----------------------------------------------------------------------------

interface InCarouselContext {
  carouselIndex: number;
  elementIndex: number;
}

interface ValidateCardOpts {
  /**
   * When set, errors emit field paths like `blocks[i].elements[j].title` so the
   * carousel-child case is distinguishable from a top-level card violation.
   */
  inCarousel?: InCarouselContext;
}

function cardFieldPath(i: number, field: string, opts?: ValidateCardOpts): string {
  if (opts?.inCarousel) {
    return `blocks[${opts.inCarousel.carouselIndex}].elements[${opts.inCarousel.elementIndex}].${field}`;
  }
  return `blocks[${i}].${field}`;
}

function cardLabel(i: number, opts?: ValidateCardOpts): string {
  if (opts?.inCarousel) {
    return `blocks[${opts.inCarousel.carouselIndex}].elements[${opts.inCarousel.elementIndex}] (card)`;
  }
  return `blocks[${i}] (card)`;
}

function validateCardImage(
  image: { image_url?: string; alt_text?: string } | undefined,
  i: number,
  fieldName: "hero_image" | "icon",
  opts: ValidateCardOpts | undefined,
): BlockValidationError[] {
  if (!image) return [];
  const errors: BlockValidationError[] = [];
  if (!image.image_url || image.image_url.length === 0) {
    errors.push({
      field: cardFieldPath(i, `${fieldName}.image_url`, opts),
      message: `${cardLabel(i, opts)} \`${fieldName}\` requires a non-empty \`image_url\`.`,
      currentLength: 0,
      limit: 0,
    });
  }
  if (!image.alt_text || image.alt_text.length === 0) {
    errors.push({
      field: cardFieldPath(i, `${fieldName}.alt_text`, opts),
      message: `${cardLabel(i, opts)} \`${fieldName}\` requires a non-empty \`alt_text\`.`,
      currentLength: 0,
      limit: 0,
    });
  }
  return errors;
}

function validateCard(
  block: Extract<Block, { type: "card" }>,
  i: number,
  opts?: ValidateCardOpts,
): BlockValidationError[] {
  const errors: BlockValidationError[] = [];
  const titleText = block.title?.text ?? "";
  const subtitleText = block.subtitle?.text ?? "";
  const bodyText = block.body?.text ?? "";

  if (titleText.length > CARD_TITLE_LIMIT) {
    errors.push({
      field: cardFieldPath(i, "title", opts),
      message: `${cardLabel(i, opts)} title (${titleText.length} chars) exceeds the ${CARD_TITLE_LIMIT}-char limit.`,
      currentLength: titleText.length,
      limit: CARD_TITLE_LIMIT,
    });
  }
  if (subtitleText.length > CARD_SUBTITLE_LIMIT) {
    errors.push({
      field: cardFieldPath(i, "subtitle", opts),
      message: `${cardLabel(i, opts)} subtitle (${subtitleText.length} chars) exceeds the ${CARD_SUBTITLE_LIMIT}-char limit.`,
      currentLength: subtitleText.length,
      limit: CARD_SUBTITLE_LIMIT,
    });
  }
  if (bodyText.length > CARD_BODY_LIMIT) {
    errors.push({
      field: cardFieldPath(i, "body", opts),
      message: `${cardLabel(i, opts)} body (${bodyText.length} chars) exceeds the ${CARD_BODY_LIMIT}-char limit.`,
      currentLength: bodyText.length,
      limit: CARD_BODY_LIMIT,
    });
  }

  errors.push(...validateCardImage(block.hero_image, i, "hero_image", opts));
  errors.push(...validateCardImage(block.icon, i, "icon", opts));

  // v1: card-level `actions` is rejected with a pointer at the top-level
  // `actions: Action[]` field. The schema parses it through (looseObject), so
  // we check at validation time.
  if ("actions" in block) {
    errors.push({
      field: cardFieldPath(i, "actions", opts),
      message: `${cardLabel(i, opts)} carries an inline \`actions\` field. Card-level actions are not supported in v1 — use the top-level \`actions: Action[]\` field on submit_response instead.`,
      currentLength: 0,
      limit: 0,
    });
  }

  // Slack's documented Card schema requires at least one of hero_image,
  // title, actions, or body. (We reject `actions` above, but it still
  // satisfies the at-least-one rule when present.)
  const hasContent =
    block.hero_image !== undefined ||
    block.title !== undefined ||
    block.body !== undefined ||
    "actions" in block;
  if (!hasContent) {
    errors.push({
      field: cardFieldPath(i, "", opts).replace(/\.$/, ""),
      message: `${cardLabel(i, opts)} must carry at least one of \`hero_image\`, \`title\`, \`actions\`, or \`body\` (per Slack's documented Card schema).`,
      currentLength: 0,
      limit: 0,
    });
  }

  return errors;
}

function validateCarousel(
  block: Extract<Block, { type: "carousel" }>,
  i: number,
): BlockValidationError[] {
  const errors: BlockValidationError[] = [];
  const elements = block.elements;

  if (elements.length < CAROUSEL_MIN_ELEMENTS || elements.length > CAROUSEL_MAX_ELEMENTS) {
    errors.push({
      field: `blocks[${i}].elements`,
      message: `blocks[${i}] (carousel) has ${elements.length} elements — must be between ${CAROUSEL_MIN_ELEMENTS} and ${CAROUSEL_MAX_ELEMENTS} inclusive.`,
      currentLength: elements.length,
      limit: CAROUSEL_MAX_ELEMENTS,
    });
  }

  elements.forEach((el, ei) => {
    if (el.type !== "card") {
      errors.push({
        field: `blocks[${i}].elements[${ei}]`,
        message: `blocks[${i}] (carousel) element[${ei}] has type \`${el.type}\`, but carousel elements must be \`card\` blocks.`,
        currentLength: 0,
        limit: 0,
      });
      return;
    }
    errors.push(
      ...validateCard(el as Extract<Block, { type: "card" }>, i, {
        inCarousel: { carouselIndex: i, elementIndex: ei },
      }),
    );
  });

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
      case "card":
        errors.push(...validateCard(block, i));
        break;
      case "carousel":
        errors.push(...validateCarousel(block, i));
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

  return errors;
}
