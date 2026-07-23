import type { AuthoredChartBlock, AuthoredTableBlock, Block } from "../../../slack/blockSchema.js";
import type { BlockValidationError } from "../../../slack/blockValidate.js";
import {
  validateBlocks as _validateBlocks,
  validateTable as _validateTable,
  validateChart as _validateChart,
} from "../../../slack/blockValidate.js";

/**
 * Run a sibling-parameter validator (`table`/`chart`) when its value is present, namespacing the
 * error field path under `pathPrefix`, and push each formatted error onto `errors`.
 */
function collectSiblingErrors<T>(
  value: T | undefined,
  name: string,
  validate: (v: T, field: string) => BlockValidationError[],
  pathPrefix: string,
  errors: string[],
): void {
  if (value === undefined) return;
  const field = pathPrefix ? `${pathPrefix}.${name}` : name;
  for (const e of validate(value, field)) {
    errors.push(`${e.field}: ${e.message}`);
  }
}
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
  chart?: AuthoredChartBlock;
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
  chart?: AuthoredChartBlock;
  /** Optional preamble — counted toward this message's length budget. */
  message?: string;
  pathPrefix: string;
  validateBlocks: typeof _validateBlocks;
  validateTable: typeof _validateTable;
  validateChart: typeof _validateChart;
}): string[] {
  const errors: string[] = [];
  const blockErrors = args.validateBlocks(args.blocks);
  for (const e of blockErrors) {
    errors.push(`${args.pathPrefix}${args.pathPrefix ? "." : ""}${e.field}: ${e.message}`);
  }
  collectSiblingErrors(args.table, "table", args.validateTable, args.pathPrefix, errors);
  collectSiblingErrors(args.chart, "chart", args.validateChart, args.pathPrefix, errors);
  const { displayText } = buildTexts(args.blocks, args.message);
  if (displayText.length > SLACK_MESSAGE_TEXT_LIMIT) {
    const where = args.pathPrefix || "primary";
    errors.push(
      `${where}: response_too_long — text (${displayText.length} chars) exceeds the ${SLACK_MESSAGE_TEXT_LIMIT}-char per-message limit. Shorten this message; each message in a multi-message batch has its own budget.`,
    );
  }
  return errors;
}
