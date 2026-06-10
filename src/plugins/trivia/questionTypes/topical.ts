/**
 * `questionType: "topical"` handler — recent-event questions. Requires an
 * HTTPS `sourceUrl` citation; optionally carries an ISO 8601 `eventDate`.
 * The shared save schema spreads these two fields in from this module; this
 * handler does the positive validation and record-extras composition.
 */

import { z } from "zod";
import type { QuestionTypeHandler, QuestionTypeValidationOutcome } from "./types.js";
import { validateEventSource } from "./eventSource.js";
import { composeWithKey } from "./compose.js";

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

export const topicalQuestionTypeHandler: QuestionTypeHandler = {
  validate(args): QuestionTypeValidationOutcome {
    return validateEventSource(args, "Topical");
  },
  composeSavedQuestion: composeWithKey,
};
