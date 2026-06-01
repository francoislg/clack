import type { JsonValue } from "../core/configTypes.js";
import type { QuestionMedia } from "../core/types.js";

/**
 * Project a `QuestionMedia` record into a plain `JsonValue` object for inclusion
 * in a tool result. `QuestionMedia` is a closed interface (no index signature),
 * so it isn't directly assignable to `JsonValue`; this builds an equivalent
 * JSON-shaped object, omitting the optional `license`/`attribution` when absent.
 */
export function mediaToJson(media: QuestionMedia): JsonValue {
  return {
    kind: media.kind,
    url: media.url,
    altText: media.altText,
    subjectId: media.subjectId,
    title: media.title,
    ...(media.license !== undefined ? { license: media.license } : {}),
    ...(media.attribution !== undefined ? { attribution: media.attribution } : {}),
  };
}
