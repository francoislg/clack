/**
 * `questionType: "fact"` handler — static knowledge questions. Has no extra
 * save fields and no positive validation beyond what the answer-format
 * handler already imposes. Implements the interface anyway so the registry
 * can iterate every tier uniformly (and so collision checks pick it up).
 */

import type { QuestionTypeHandler } from "./types.js";
import { composeWithKey } from "./compose.js";

/** No-op fragment — fact questions add no per-tier save fields. */
export const FACT_SAVE_FIELDS = {} as const;

export const factQuestionTypeHandler: QuestionTypeHandler = {
  validate(_args) {
    return { ok: true, recordExtras: {} };
  },
  composeSavedQuestion: composeWithKey,
};
