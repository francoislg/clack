/**
 * `questionType: "topical"` handler — recent-event questions. Requires an
 * HTTPS `sourceUrl` citation; optionally carries an ISO 8601 `eventDate`.
 * The shared save schema spreads these two fields in from this module; this
 * handler does the positive validation and record-extras composition.
 */

import { z } from "zod";
import type { JsonValue } from "../core/configTypes.js";
import type { QuestionTypeHandler, QuestionTypeValidationOutcome } from "./types.js";

/**
 * Per-tier Zod field-fragment for `save_question`. Spread into the tool's
 * input schema at module load by the registry. Adding a new question-type
 * means writing a new fragment; no edits to the shared schema or sibling
 * handlers.
 */
export const TOPICAL_SAVE_FIELDS = {
  sourceUrl: z
    .string()
    .optional()
    .describe(
      'REQUIRED when questionType is "topical" (HTTPS URL). FORBIDDEN when questionType is "fact".',
    ),
  eventDate: z
    .string()
    .optional()
    .describe(
      "OPTIONAL on topical questions: ISO 8601 calendar date of the event (YYYY-MM-DD). Forbidden on fact questions.",
    ),
} as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const topicalQuestionTypeHandler: QuestionTypeHandler = {
  validate(args): QuestionTypeValidationOutcome {
    if (args.sourceUrl === undefined || args.sourceUrl.length === 0) {
      return {
        ok: false,
        error: 'Topical questions require "sourceUrl" (an HTTPS citation URL).',
      };
    }
    if (!args.sourceUrl.startsWith("https://")) {
      return { ok: false, error: '"sourceUrl" must use https://.' };
    }
    const hostPart = args.sourceUrl.slice("https://".length).split("/")[0];
    if (hostPart.length === 0 || !hostPart.includes(".")) {
      return { ok: false, error: '"sourceUrl" must include a valid host.' };
    }
    if (args.eventDate !== undefined && !ISO_DATE_RE.test(args.eventDate)) {
      return {
        ok: false,
        error: '"eventDate" must be ISO 8601 calendar date (YYYY-MM-DD).',
      };
    }
    const recordExtras: Record<string, JsonValue> = { sourceUrl: args.sourceUrl };
    if (args.eventDate !== undefined) recordExtras.eventDate = args.eventDate;
    return { ok: true, recordExtras };
  },
};
