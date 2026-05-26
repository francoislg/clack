/**
 * Lookup for the per-format `AnswerTypeHandler`. Callers dispatch through
 * this registry instead of branching on format strings — adding a fourth
 * format would only require registering one new handler here.
 */

import type { TriviaAnswersFormat } from "../core/types.js";
import { BOOLEAN_SAVE_FIELDS, booleanAnswerHandler } from "./boolean.js";
import { CHOICE_SAVE_FIELDS, choiceAnswerHandler } from "./choice.js";
import { FREEFORM_SAVE_FIELDS, freeformAnswerHandler } from "./freeform.js";
import type { AnswerTypeHandler } from "./types.js";

const HANDLERS: Record<TriviaAnswersFormat, AnswerTypeHandler> = {
  boolean: booleanAnswerHandler,
  choice: choiceAnswerHandler,
  freeform: freeformAnswerHandler,
};

/**
 * Stable iteration order for `getAllAnswerTypeHandlers`. Boolean and choice
 * come before freeform because the boot-time `registerInteractions` calls
 * happen in this order; tests assert against the order so changing it is a
 * deliberate decision.
 */
const HANDLERS_IN_ORDER: readonly AnswerTypeHandler[] = [
  booleanAnswerHandler,
  choiceAnswerHandler,
  freeformAnswerHandler,
];

/**
 * Composite Zod field-fragment merging every format's per-format save schema.
 * `saveSchema.ts` spreads this into the `save_question` tool's input alongside
 * the cross-format common fields. Adding a 4th format means writing one new
 * `*_SAVE_FIELDS` and adding it to this spread — no other module changes.
 */
export const ALL_ANSWER_TYPE_SAVE_FIELDS = {
  ...BOOLEAN_SAVE_FIELDS,
  ...CHOICE_SAVE_FIELDS,
  ...FREEFORM_SAVE_FIELDS,
} as const;

/**
 * Per-format set of save-args field names. Used by `save_question`'s central
 * collision check: for the active format, every OTHER format's field names
 * must be undefined on the incoming args. Replaces the per-handler "MUST NOT
 * include X" negative checks that used to live in every `getSavedQuestion`.
 */
export const ANSWER_TYPE_SAVE_FIELD_NAMES: Record<TriviaAnswersFormat, readonly string[]> = {
  boolean: Object.keys(BOOLEAN_SAVE_FIELDS),
  choice: Object.keys(CHOICE_SAVE_FIELDS),
  freeform: Object.keys(FREEFORM_SAVE_FIELDS),
};

/**
 * Return the handler for a question's stored format. Legacy rows (no
 * `answersFormat` field) read as `"boolean"`, matching every other call site
 * that special-cases legacy data.
 */
export function getAnswerTypeHandler(format: TriviaAnswersFormat | undefined): AnswerTypeHandler {
  return HANDLERS[format ?? "boolean"];
}

/**
 * Every registered handler, in a stable iteration order. Used by the boot-time
 * `registerInteractiveHandlers` loop to install per-handler action-id
 * registrations without the caller needing to know which formats exist.
 */
export function getAllAnswerTypeHandlers(): readonly AnswerTypeHandler[] {
  return HANDLERS_IN_ORDER;
}

export type { AnswerTypeHandler, ClickableAnswerHandler, ResolvedClick } from "./types.js";
export { isClickableHandler } from "./types.js";
