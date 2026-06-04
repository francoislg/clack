import type { KnownBlock } from "@slack/types";
import type { JsonValue } from "../core/configTypes.js";

/**
 * Project Block Kit blocks into a plain `JsonValue` for inclusion in a tool
 * result. `KnownBlock[]` is a closed union (no index signature), so it isn't
 * directly assignable to `JsonValue`; this round-trips through JSON to produce an
 * equivalent JSON-shaped value. Mirrors `mediaToJson`. Block Kit is always
 * JSON-serializable, so the round-trip is lossless.
 */
export function blocksToJson(blocks: KnownBlock[]): JsonValue {
  return JSON.parse(JSON.stringify(blocks));
}
