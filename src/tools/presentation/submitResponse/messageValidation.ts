import type { AuthoredTableBlock, Block } from "../../../slack/blockSchema.js";
import {
  validateBlocks as _validateBlocks,
  validateTable as _validateTable,
} from "../../../slack/blockValidate.js";
import { extractDisplayText } from "../../../slack/blockText.js";

/** Slack's `chat.postMessage` text limit — each message in a batch gets its own budget. */
export const SLACK_MESSAGE_TEXT_LIMIT = 10000;

export function buildTexts(blocks: readonly Block[], message?: string) {
  const answerText = extractDisplayText(blocks);
  const displayText = message ? `${message}\n\n${answerText}` : answerText;
  return { answerText, displayText };
}

/**
 * A single deliverable message paired with the path prefix used in batch-error labels.
 * Yielded by `enumerateBatchMessages` and the deliver_to validator, consumed by the
 * per-message validation loop.
 */
export interface BatchMessage {
  blocks: Block[];
  table?: AuthoredTableBlock;
  message?: string;
  pathPrefix: string;
}

/**
 * Per-message validation: block schema + table schema + length budget. Each Slack message
 * gets its own 10,000-char budget — no aggregate sum across the batch. Returns a flat list
 * of error strings, each path-prefixed.
 */
export function validateSingleMessage(args: {
  blocks: Block[];
  table?: AuthoredTableBlock;
  /** Optional preamble — counted toward this message's length budget. */
  message?: string;
  pathPrefix: string;
  validateBlocks: typeof _validateBlocks;
  validateTable: typeof _validateTable;
}): string[] {
  const errors: string[] = [];
  const blockErrors = args.validateBlocks(args.blocks);
  for (const e of blockErrors) {
    errors.push(`${args.pathPrefix}${args.pathPrefix ? "." : ""}${e.field}: ${e.message}`);
  }
  if (args.table) {
    const tableField = args.pathPrefix ? `${args.pathPrefix}.table` : "table";
    const tableErrors = args.validateTable(args.table, tableField);
    for (const e of tableErrors) {
      errors.push(`${e.field}: ${e.message}`);
    }
  }
  const { displayText } = buildTexts(args.blocks, args.message);
  if (displayText.length > SLACK_MESSAGE_TEXT_LIMIT) {
    const where = args.pathPrefix || "primary";
    errors.push(
      `${where}: response_too_long — text (${displayText.length} chars) exceeds the ${SLACK_MESSAGE_TEXT_LIMIT}-char per-message limit. Shorten this message; each message in a multi-message batch has its own budget.`,
    );
  }
  return errors;
}
