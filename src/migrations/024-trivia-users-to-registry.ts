import type { Migration, StaticFileResult } from "./types.js";
import { logger } from "../logger.js";

/**
 * Fold the trivia plugin's standalone user file (`data/plugins/trivia/users.json`) into the
 * new central user registry (`data/state/users.json`). Identity (`userId`, `displayName`) moves
 * to the core record; trivia's `joinedAt` / `cheatAttempts` move to the `plugins.trivia`
 * namespace. The trivia file is removed afterward.
 *
 * Algorithm:
 *   1. Read `data/plugins/trivia/users.json`. If missing, no-op (fresh install or already run).
 *   2. Read the central registry (if present); merge each trivia user into it — preserving any
 *      existing identity/lastFetched and other plugins' namespaces.
 *   3. Stage the merged registry write and drop the trivia file.
 *
 * Migrated records carry `lastFetched: 0` (unless the registry already had a fresher value), so
 * the first `sdk.users.get` refreshes the display name from Slack.
 *
 * Idempotent: a second run hits step 1's no-op early-return (the trivia file is gone).
 * Blocking so it completes before the trivia plugin loads.
 */

const TRIVIA_USERS_PATH = "data/plugins/trivia/users.json";
const REGISTRY_PATH = "data/state/users.json";

type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonObjectShape {
  [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonArray | JsonObjectShape;

function isJsonObject(value: unknown): value is JsonObjectShape {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parse(raw: string | null, label: string): JsonObjectShape | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isJsonObject(parsed) ? parsed : null;
  } catch (err) {
    logger.warn(
      `[migration 024] ${label} is not valid JSON (${err instanceof Error ? err.message : String(err)}) — skipping`,
    );
    return null;
  }
}

// Files are identified by path suffix, not exact key: the test runner rewrites the keys to
// sandboxed absolute paths, while production passes the relative constants.
function entryFor(
  files: Record<string, string | null>,
  suffix: string,
): { key: string; raw: string | null } | null {
  for (const [key, raw] of Object.entries(files)) {
    if (key.endsWith(suffix)) return { key, raw };
  }
  return null;
}

/**
 * Pure transform. Given the two file contents (each may be `null` for missing), returns the
 * staged registry write plus the trivia-file drop (or empty for no-ops). Exported for test reach.
 */
export function foldTriviaUsersIntoRegistry(
  files: Record<string, string | null>,
): Record<string, StaticFileResult> {
  const triviaEntry = entryFor(files, TRIVIA_USERS_PATH);
  const registryEntry = entryFor(files, REGISTRY_PATH);
  if (triviaEntry === null || registryEntry === null) {
    return {}; // the migration always declares both files; defensive guard
  }

  const triviaUsers = parse(triviaEntry.raw, TRIVIA_USERS_PATH);
  if (triviaUsers === null || Object.keys(triviaUsers).length === 0) {
    return {}; // no trivia users (missing, empty, or unreadable) — leave both files untouched
  }

  const registry = parse(registryEntry.raw, REGISTRY_PATH) ?? {};

  for (const [userId, value] of Object.entries(triviaUsers)) {
    if (!isJsonObject(value)) continue;

    const displayName = typeof value.displayName === "string" ? value.displayName : userId;
    const namespace: JsonObjectShape = {};
    if (typeof value.joinedAt === "number") namespace.joinedAt = value.joinedAt;
    if (typeof value.cheatAttempts === "number" && value.cheatAttempts > 0) {
      namespace.cheatAttempts = value.cheatAttempts;
    }

    const existing = isJsonObject(registry[userId]) ? registry[userId] : {};
    const existingPlugins = isJsonObject(existing.plugins) ? existing.plugins : {};
    const existingTrivia = isJsonObject(existingPlugins.trivia) ? existingPlugins.trivia : {};

    registry[userId] = {
      userId,
      displayName: typeof existing.displayName === "string" ? existing.displayName : displayName,
      lastFetched: typeof existing.lastFetched === "number" ? existing.lastFetched : 0,
      plugins: { ...existingPlugins, trivia: { ...existingTrivia, ...namespace } },
    };
  }

  logger.info(
    `[migration 024] Folded ${Object.keys(triviaUsers).length} trivia user(s) into ${REGISTRY_PATH}`,
  );
  return {
    [registryEntry.key]: JSON.stringify(registry, null, 2) + "\n",
    [triviaEntry.key]: { delete: true },
  };
}

export const migration: Migration = {
  version: 24,
  name: "Trivia: fold users.json into central data/state/users.json registry",
  priority: "blocking",
  files: [TRIVIA_USERS_PATH, REGISTRY_PATH],
  static: foldTriviaUsersIntoRegistry,
};
