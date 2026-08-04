import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import { createRecordStore } from "./state/resilientStore.js";
import type { JsonObject } from "./config.js";

// ============================================================================
// Dependency Injection
// ============================================================================

export interface UserPreferencesDeps {
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  mkdir: typeof mkdir;
  fileExists: typeof fileExists;
}

export const defaultUserPreferencesDeps: UserPreferencesDeps = {
  readFile,
  writeFile,
  mkdir,
  fileExists,
};

let deps: UserPreferencesDeps = defaultUserPreferencesDeps;

export function setUserPreferencesDeps(d: UserPreferencesDeps): void {
  deps = d;
}

export function resetUserPreferencesDeps(): void {
  deps = defaultUserPreferencesDeps;
}

export type ReactionDelivery = "dm" | "thread";

export interface UserPreferences {
  dmOptOut?: boolean; // deprecated, kept for migration
  reactionDelivery: ReactionDelivery;
  /** Post a short follow-up message after streaming so the user gets a Slack notification. */
  notifyOnResponse: boolean;
  /** Tag (ping) the requester in the investigation parent message. */
  investigationTag: boolean;
  /** Whether starting an investigation posts a breadcrumb reply in the origin thread. */
  investigationBreadcrumb: "silent" | "explicit";
  /** Per-plugin user-chosen preference slice, surfaced in the Personal Preferences modal. Keyed by plugin name. */
  plugins?: { [plugin: string]: JsonObject };
}

const DEFAULT_PREFERENCES: UserPreferences = {
  reactionDelivery: "dm",
  notifyOnResponse: false,
  investigationTag: false,
  investigationBreadcrumb: "silent",
};

type PreferencesMap = Record<string, Partial<UserPreferences>>;

/**
 * Per-user entry schema for `user-preferences.json`. The deprecated `dmOptOut` is accepted on disk
 * but NOT modeled here, so zod strips it — it never reaches the runtime map. One malformed user's
 * value is quarantined by the shared record store; the rest load.
 */
const preferencesEntryZod = z.object({
  reactionDelivery: z.enum(["dm", "thread"]).optional(),
  notifyOnResponse: z.boolean().optional(),
  investigationTag: z.boolean().optional(),
  investigationBreadcrumb: z.enum(["silent", "explicit"]).optional(),
  plugins: z.record(z.string(), z.custom<JsonObject>()).optional(),
});

// Standing prefs ride the shared resilient RECORD store (per-user quarantine + freeze). The store
// deps read the live `deps` binding so `setUserPreferencesDeps` overrides at runtime are honored.
const store = createRecordStore<Partial<UserPreferences>>({
  storeId: "user-preferences",
  label: "user preferences",
  getPath: () => resolve(process.cwd(), "data", "state", "user-preferences.json"),
  entrySchema: preferencesEntryZod,
  deps: {
    readFile: (path) => deps.readFile(path, "utf-8"),
    writeFile: (path, data) => deps.writeFile(path, data),
    fileExists: (path) => deps.fileExists(path),
    mkdir: (path, opts) => deps.mkdir(path, opts),
  },
});

export async function loadPreferences(): Promise<PreferencesMap> {
  return store.load();
}

export async function savePreferences(prefs: PreferencesMap): Promise<void> {
  await store.save(prefs);
  logger.debug("User preferences saved");
}

export async function getUserPreference<K extends keyof UserPreferences>(
  userId: string,
  key: K,
): Promise<UserPreferences[K]> {
  const prefs = await loadPreferences();
  const userPrefs = prefs[userId];
  if (userPrefs && key in userPrefs) {
    return userPrefs[key] as UserPreferences[K];
  }
  return DEFAULT_PREFERENCES[key];
}

export async function setUserPreference<K extends keyof UserPreferences>(
  userId: string,
  key: K,
  value: UserPreferences[K],
): Promise<void> {
  const prefs = await loadPreferences();
  if (!prefs[userId]) {
    prefs[userId] = {};
  }
  prefs[userId][key] = value;
  await savePreferences(prefs);
}

/**
 * Read one plugin's preference slice for a user, or null if unset.
 */
export async function getPluginPreferenceSlice(
  plugin: string,
  userId: string,
): Promise<JsonObject | null> {
  const prefs = await loadPreferences();
  const slice = prefs[userId]?.plugins?.[plugin];
  return (slice as JsonObject | undefined) ?? null;
}

/**
 * Merge a partial slice into one plugin's preferences for a user, preserving core fields, other plugins, and untouched keys.
 */
export async function mergePluginPreferenceSlice(
  plugin: string,
  userId: string,
  partial: JsonObject,
): Promise<void> {
  const prefs = await loadPreferences();
  const entry = prefs[userId] ?? {};
  const existingPlugins = entry.plugins ?? {};
  const existingSlice = existingPlugins[plugin] ?? {};
  prefs[userId] = {
    ...entry,
    plugins: { ...existingPlugins, [plugin]: { ...existingSlice, ...partial } },
  };
  await savePreferences(prefs);
}

/**
 * Get the user's preferred reaction delivery mode ("dm" or "thread").
 * Defaults to "dm" if not set.
 */
export function getReactionDelivery(userId: string): Promise<ReactionDelivery> {
  return getUserPreference(userId, "reactionDelivery");
}

// Clear cache (useful for testing)
export function clearPreferencesCache(): void {
  store.clearCache();
}
