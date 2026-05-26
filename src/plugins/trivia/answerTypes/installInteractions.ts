/**
 * Plugin-boot interaction-handler installer. This file is intentionally tiny:
 * each answer-format handler owns its own action_id registration via
 * `handler.registerInteractions(sdk, deps)`. This module's only job is to walk
 * the registry and invoke that hook on every handler.
 *
 * Past versions of this file embedded the boolean/choice `vote:*` registration
 * and the freeform `freeform-answer:*` modal trigger directly, which meant
 * adding a fourth answer format would have required editing this file. The
 * registry-loop pattern means a new format just needs a new handler module —
 * this file stays unchanged.
 */

import type { ClackSdk } from "../../sdk.js";
import type { TriviaDataLayer } from "../core/types.js";
import { getAllAnswerTypeHandlers } from "./registry.js";

export interface InteractiveHandlerDeps {
  data: TriviaDataLayer;
  sdk: ClackSdk;
  getGameNames: () => string[];
}

/**
 * Register every answer-format handler's interaction hooks with the SDK.
 * Called once at plugin boot from `src/plugins/trivia/index.ts`.
 */
export function registerInteractiveHandlers(deps: InteractiveHandlerDeps): void {
  for (const handler of getAllAnswerTypeHandlers()) {
    handler.registerInteractions(deps.sdk, {
      data: deps.data,
      getGameNames: deps.getGameNames,
    });
  }
}
