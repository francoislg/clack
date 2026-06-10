/**
 * `questionType: "prediction"` handler — questions about an UPCOMING event whose
 * outcome is unknown at write time. Like `topical`, it requires an HTTPS `sourceUrl`
 * (a link to the upcoming event) and optionally carries an `eventDate`. Unlike every
 * other type, it composes its record via the DEFERRED save path: `save_question`
 * persists `resolved: false` and NO answer key, and `settle_question` stamps the key
 * once the result is known. Composes with every answer format (boolean/choice/freeform).
 */

import type { QuestionTypeHandler, QuestionTypeValidationOutcome } from "./types.js";
import { validateEventSource } from "./eventSource.js";
import { composeDeferred } from "./compose.js";

export const predictionQuestionTypeHandler: QuestionTypeHandler = {
  validate(args): QuestionTypeValidationOutcome {
    const outcome = validateEventSource(args, "Prediction");
    if (!outcome.ok) return outcome;
    return { ok: true, recordExtras: { ...outcome.recordExtras, resolved: false } };
  },
  composeSavedQuestion: composeDeferred,
};
