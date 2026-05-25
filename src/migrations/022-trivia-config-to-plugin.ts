import type { Migration, StaticFileResult } from "./types.js";
import { logger } from "../logger.js";

/**
 * Relocate the trivia plugin's configuration from `data/config.json.trivia`
 * to a plugin-owned file at `data/plugins/trivia/config.json`. The trivia
 * plugin now owns its configuration (types, parsers, file I/O) per the
 * SDK-isolation rules — see src/plugins/CLAUDE.md.
 *
 * Algorithm:
 *
 *   1. Read `data/config.json`. If no `trivia` field, no-op.
 *   2. Read `data/plugins/trivia/config.json` (if present). If non-empty
 *      object, EXIT with an error pointing operators at both sources for
 *      manual reconciliation — never silently pick a winner.
 *   3. Stage a write of `data/config.json`'s `trivia` block to the plugin file.
 *   4. Stage a rewrite of `data/config.json` with the `trivia` field removed.
 *
 * Idempotent: a second run hits step 1's no-op early-return.
 * Blocking priority so it completes before the trivia plugin loads.
 */

const CONFIG_PATH = "data/config.json";
const PLUGIN_CONFIG_PATH = "data/plugins/trivia/config.json";

type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonObjectShape {
  [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonArray | JsonObjectShape;

function isJsonObject(value: unknown): value is JsonObjectShape {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyJsonObject(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return Object.keys(value).length > 0;
}

/**
 * Pure transform. Given the two file contents (each may be `null` for missing),
 * returns the staged writes (or empty for no-ops / conflicts). Exported for
 * test reach — the migration's `static` field is a thin wrapper.
 */
export function relocateTriviaConfig(
  files: Record<string, string | null>,
): Record<string, StaticFileResult> {
  const configRaw = files[CONFIG_PATH];
  const pluginRaw = files[PLUGIN_CONFIG_PATH];

  if (configRaw === null) {
    return {}; // no main config — fresh install, nothing to relocate
  }

  let mainConfig: unknown;
  try {
    mainConfig = JSON.parse(configRaw);
  } catch (err) {
    logger.warn(
      `[migration 022] ${CONFIG_PATH} is not valid JSON (${err instanceof Error ? err.message : String(err)}) — skipping relocation`,
    );
    return {};
  }

  if (!isJsonObject(mainConfig)) {
    return {}; // main config is not an object — leave it alone
  }
  if (mainConfig.trivia === undefined) {
    return {}; // already relocated (or never set)
  }

  // Conflict detection: if the plugin file already has content, the operator
  // has either already migrated manually or has hand-edited it. Don't silently
  // pick a winner.
  if (pluginRaw !== null) {
    let pluginExisting: unknown;
    try {
      pluginExisting = JSON.parse(pluginRaw);
    } catch (err) {
      logger.error(
        `[migration 022] ${PLUGIN_CONFIG_PATH} is not valid JSON (${err instanceof Error ? err.message : String(err)}) — refusing to relocate; operator must fix or remove the file`,
      );
      return {};
    }
    if (isNonEmptyJsonObject(pluginExisting)) {
      logger.error(
        `[migration 022] Both ${CONFIG_PATH}.trivia AND ${PLUGIN_CONFIG_PATH} carry content. ` +
          `Resolve by hand (keep one, blank the other) then re-run.`,
      );
      return {};
    }
  }

  // Stage: write trivia block to the plugin file, drop the trivia field from main config.
  const triviaBlock: JsonValue = mainConfig.trivia ?? {};
  const nextMain: JsonObjectShape = { ...mainConfig };
  delete nextMain.trivia;

  logger.info(`[migration 022] Moving ${CONFIG_PATH}.trivia → ${PLUGIN_CONFIG_PATH}`);
  return {
    [PLUGIN_CONFIG_PATH]: JSON.stringify(triviaBlock, null, 2) + "\n",
    [CONFIG_PATH]: JSON.stringify(nextMain, null, 2) + "\n",
  };
}

export const migration: Migration = {
  version: 22,
  name: "Trivia: relocate config to data/plugins/trivia/config.json",
  priority: "blocking",
  files: [CONFIG_PATH, PLUGIN_CONFIG_PATH],
  static: relocateTriviaConfig,
};
