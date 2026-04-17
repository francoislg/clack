import type { Block } from "./blockSchema.js";

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
      case "divider":
        // Shape-only; nothing to validate beyond the schema parse.
        break;
    }
  });

  return errors;
}
