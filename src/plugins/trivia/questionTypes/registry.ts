/**
 * Lookup for the per-question-type `QuestionTypeHandler`. Callers dispatch
 * through this registry instead of branching on `questionType === "..."` —
 * adding an `opinion` tier would only require registering one new handler
 * here and writing its module.
 */

import type { TriviaQuestionType } from "../core/types.js";
import { FACT_SAVE_FIELDS, factQuestionTypeHandler } from "./fact.js";
import { TOPICAL_SAVE_FIELDS, topicalQuestionTypeHandler } from "./topical.js";
import { predictionQuestionTypeHandler } from "./prediction.js";
import type { QuestionTypeHandler } from "./types.js";

const HANDLERS: Record<TriviaQuestionType, QuestionTypeHandler> = {
  fact: factQuestionTypeHandler,
  topical: topicalQuestionTypeHandler,
  prediction: predictionQuestionTypeHandler,
};

export function getQuestionTypeHandler(
  questionType: TriviaQuestionType | undefined,
): QuestionTypeHandler {
  return HANDLERS[questionType ?? "fact"];
}

/**
 * Composite Zod field-fragment merging every question-type's per-tier save
 * schema. `saveSchema.ts` spreads this into the `save_question` tool's input
 * alongside the cross-tier common fields and the answersFormat fragments.
 */
export const ALL_QUESTION_TYPE_SAVE_FIELDS = {
  ...FACT_SAVE_FIELDS,
  ...TOPICAL_SAVE_FIELDS,
} as const;

/**
 * Per-tier set of save-args field names. Used by `save_question`'s central
 * collision check: for the active questionType, every OTHER tier's field
 * names must be undefined on the incoming args.
 */
export const QUESTION_TYPE_SAVE_FIELD_NAMES: Record<TriviaQuestionType, readonly string[]> = {
  fact: Object.keys(FACT_SAVE_FIELDS),
  topical: Object.keys(TOPICAL_SAVE_FIELDS),
  // Prediction reuses topical's `sourceUrl` / `eventDate` fields — same web-search
  // citation, no separate schema fragment. Sharing the field names keeps the
  // central collision check from treating either type's fields as foreign.
  prediction: Object.keys(TOPICAL_SAVE_FIELDS),
};
