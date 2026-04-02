import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";

export type ReactionDelivery = "dm" | "thread";

export interface UserPreferences {
  dmOptOut?: boolean; // deprecated, kept for migration
  reactionDelivery: ReactionDelivery;
  /** Post a short follow-up message after streaming so the user gets a Slack notification. */
  notifyOnResponse: boolean;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  reactionDelivery: "dm",
  notifyOnResponse: false,
};

type PreferencesMap = Record<string, Partial<UserPreferences>>;

let cachedPreferences: PreferencesMap | null = null;

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getPreferencesPath(): string {
  return resolve(getStateDir(), "user-preferences.json");
}

export async function loadPreferences(): Promise<PreferencesMap> {
  if (cachedPreferences) {
    return cachedPreferences;
  }

  const prefsPath = getPreferencesPath();

  if (!(await fileExists(prefsPath))) {
    cachedPreferences = {};
    return cachedPreferences;
  }

  try {
    const content = await readFile(prefsPath, "utf-8");
    cachedPreferences = JSON.parse(content) as PreferencesMap;
    return cachedPreferences;
  } catch (error) {
    logger.error("Failed to load user preferences:", error);
    cachedPreferences = {};
    return cachedPreferences;
  }
}

export async function savePreferences(prefs: PreferencesMap): Promise<void> {
  const stateDir = getStateDir();
  const prefsPath = getPreferencesPath();

  if (!(await fileExists(stateDir))) {
    await mkdir(stateDir, { recursive: true });
  }

  await writeFile(prefsPath, JSON.stringify(prefs, null, 2));
  cachedPreferences = prefs;
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
 * Get the user's preferred reaction delivery mode ("dm" or "thread").
 * Defaults to "dm" if not set.
 */
export function getReactionDelivery(userId: string): Promise<ReactionDelivery> {
  return getUserPreference(userId, "reactionDelivery");
}

// Clear cache (useful for testing)
export function clearPreferencesCache(): void {
  cachedPreferences = null;
}
