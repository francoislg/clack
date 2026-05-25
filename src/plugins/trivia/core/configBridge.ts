/**
 * Trivia plugin config bridge. Owns the in-memory cache of the parsed
 * `TriviaConfig` and the read/write pipeline against `data/plugins/trivia/config.json`.
 *
 * Per the plugin hard rules (see src/plugins/CLAUDE.md), this module uses ONLY
 * the SDK — never `node:fs`, never imports from src/config.ts or src/logger.ts.
 * The SDK's `readFile`/`writeFile` resolve paths under the plugin's data dir,
 * so passing `"config.json"` lands at `data/plugins/trivia/config.json`.
 */

import type { ClackSdk, PluginLogger } from "../../sdk.js";
import type { JsonObject, TriviaConfig, TriviaGame } from "./configTypes.js";
import {
  parseTriviaAxisBag,
  validateTriviaChoicesConfig,
  type ParseIssue,
} from "./configParsers/axes.js";
import { parseOffDays, parseTriviaGames } from "./configParsers/games.js";

const CONFIG_FILENAME = "config.json";

let cached: TriviaConfig | null | undefined;
let sdkRef: ClackSdk | null = null;

function reloadInBackground(sdk: ClackSdk): void {
  readAndParse(sdk)
    .then((next) => {
      cached = next;
      sdk.logger.info("Reloaded trivia plugin config after file change");
    })
    .catch((err: unknown) => {
      sdk.logger.error(
        "Failed to reload trivia plugin config after file change:",
        err instanceof Error ? err.message : String(err),
      );
    });
}

/**
 * Warm the in-memory cache and wire the file watcher. Call once during plugin
 * load BEFORE any tool runs. Subsequent `loadTriviaConfig()` calls are synchronous.
 */
export async function initTriviaConfigBridge(sdk: ClackSdk): Promise<void> {
  sdkRef = sdk;
  cached = await readAndParse(sdk);
  // External edits (e.g. an admin editing the file directly) should invalidate
  // the cache so the next tool call observes the new state.
  sdk.watchFile(CONFIG_FILENAME, () => {
    reloadInBackground(sdk);
  });
}

/**
 * Synchronous accessor used by tool handlers + resolvers. Returns the cached
 * `TriviaConfig` or `null` if the file is absent / not yet loaded.
 */
export function loadTriviaConfig(): TriviaConfig | null {
  return cached ?? null;
}

/**
 * Persist `next` to `data/plugins/trivia/config.json` (pretty-printed,
 * 2-space indent) and refresh the cache so subsequent reads see the new value.
 */
export async function saveTriviaConfig(next: TriviaConfig): Promise<void> {
  if (sdkRef === null) {
    throw new Error(
      "trivia config bridge is not initialized — call initTriviaConfigBridge(sdk) first",
    );
  }
  const content = JSON.stringify(next, null, 2) + "\n";
  await sdkRef.writeFile(CONFIG_FILENAME, content);
  cached = next;
}

async function readAndParse(sdk: ClackSdk): Promise<TriviaConfig | null> {
  const raw = await sdk.readFile(CONFIG_FILENAME);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Trivia plugin config (data/plugins/trivia/${CONFIG_FILENAME}) is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Trivia plugin config (data/plugins/trivia/${CONFIG_FILENAME}) must be a JSON object (got ${typeof parsed})`,
    );
  }
  return parseTriviaConfigObject(parsed as JsonObject, sdk.logger);
}

function parseTriviaConfigObject(raw: JsonObject, logger: PluginLogger): TriviaConfig {
  const out: TriviaConfig = {};
  const allIssues: ParseIssue[] = [];

  // 5-axis bag: shared with workspace / game / season / slot tiers.
  const { axes, issues: axisIssues } = parseTriviaAxisBag(raw, "trivia");
  Object.assign(out, axes);
  allIssues.push(...axisIssues);

  if (raw.choices !== undefined) {
    const r = validateTriviaChoicesConfig(raw.choices, "trivia.choices");
    if (r.ok) out.choices = r.value;
    else allIssues.push({ field: "trivia.choices", error: r.error });
  }

  const { games, issues: gameIssues } = parseTriviaGames(raw.games);
  if (games !== undefined) out.games = games;
  allIssues.push(...gameIssues);

  const { offDays, issues: offDayIssues } = parseOffDays(raw.offDays);
  if (offDays !== undefined) out.offDays = offDays;
  allIssues.push(...offDayIssues);

  // seasons block: { enabled, prompt }. The enabled-but-no-prompt case
  // self-disables rather than rejecting (matches the prior loader behavior).
  if (raw.seasons !== undefined && raw.seasons !== null) {
    if (typeof raw.seasons === "object" && !Array.isArray(raw.seasons)) {
      const s = raw.seasons as JsonObject;
      const enabled = typeof s.enabled === "boolean" ? s.enabled : false;
      const prompt = typeof s.prompt === "string" ? s.prompt : "";
      if (enabled && prompt.trim().length === 0) {
        logger.warn(
          "Trivia plugin config 'seasons.enabled' is true but 'seasons.prompt' is missing — disabling seasons",
        );
        out.seasons = { enabled: false, prompt: "" };
      } else {
        out.seasons = { enabled, prompt };
      }
    } else {
      allIssues.push({ field: "trivia.seasons", error: "must be an object" });
    }
  }

  for (const issue of allIssues) {
    logger.warn(`Trivia plugin config: '${issue.field}': ${issue.error}`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Test-only helpers (NOT for production use)
// ---------------------------------------------------------------------------

/** Reset the cache + SDK reference. Tests call this to isolate state. */
export function _resetTriviaConfigBridge(): void {
  cached = undefined;
  sdkRef = null;
}

/** Inject a config snapshot directly (bypasses file I/O). Tests only. */
export function _setTriviaConfigForTests(value: TriviaConfig | null): void {
  cached = value;
}

/**
 * Inject a fake SDK so `saveTriviaConfig()` can run in tests without going
 * through `initTriviaConfigBridge` (which expects a full plugin bootstrap).
 * Tests only.
 */
export function _setTriviaConfigSdkForTests(sdk: ClackSdk | null): void {
  sdkRef = sdk;
}

// ---------------------------------------------------------------------------
// Legacy accessor shape (kept so existing tool injection sites don't churn).
// ---------------------------------------------------------------------------

export type GetGamesFn = () => readonly TriviaGame[];

export const defaultGetGames: GetGamesFn = () => loadTriviaConfig()?.games ?? [];

export type GetTriviaConfigFn = () => TriviaConfig | null;

export const defaultGetTriviaConfig: GetTriviaConfigFn = () => loadTriviaConfig();
