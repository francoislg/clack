import type { App } from "@slack/bolt";
import { logger } from "../logger.js";
import { getUserRecord, upsertIdentity, type UserIdentity } from "../userRegistry.js";

export interface UserInfo {
  userId: string;
  username?: string;
  displayName?: string;
  isBot?: boolean;
  tz?: string;
}

const userCache = new Map<string, UserInfo>();

// How long a persisted display name is considered fresh before `resolveUserIdentity`
// re-fetches it from Slack. Lives here (not in config) — refresh logic owns the knob.
const DISPLAY_NAME_TTL_MS = 6 * 60 * 60 * 1000;

// Dedupes concurrent stale refreshes so two simultaneous resolves of the same user trigger
// at most one Slack call.
const inFlightFetches = new Map<string, Promise<UserInfo | undefined>>();

// Slack platform errors that mean "this ID cannot be resolved by this bot" — an
// expected outcome (deactivated users, external Slack Connect users, cross-workspace
// IDs) rather than an operational failure. The SDK throws rather than returning
// { ok: false } for these, so we normalize to the same debug-level handling.
const EXPECTED_LOOKUP_ERRORS = new Set(["user_not_found", "user_not_visible", "bot_not_found"]);

interface SlackPlatformError {
  data?: { error?: string };
}

function isExpectedLookupError(error: SlackPlatformError | null | undefined): boolean {
  const code = error?.data?.error;
  return typeof code === "string" && EXPECTED_LOOKUP_ERRORS.has(code);
}

/**
 * Get user info from cache or fetch from Slack API.
 * Returns undefined if the user cannot be resolved.
 */
export async function getUserInfo(
  client: App["client"],
  userId: string,
): Promise<UserInfo | undefined> {
  // Return cached value if present
  const cached = userCache.get(userId);
  if (cached) {
    return cached;
  }

  // Synthetic user IDs (e.g., auto-respond) — return fallback without API call
  if (userId === "auto-respond") {
    const fallback: UserInfo = { userId, displayName: "Auto-Respond" };
    userCache.set(userId, fallback);
    return fallback;
  }

  return fetchUserInfo(client, userId);
}

// The display name to persist into the registry — Slack profile name, else username, else
// the raw id so a record never carries an empty identity once a fetch has succeeded.
function registryDisplayName(info: UserInfo): string {
  return info.displayName ?? info.username ?? info.userId;
}

// Always hits Slack (no in-memory short-circuit), caches the result, and write-throughs the
// resolved identity into the central registry. This is the single core resolution primitive.
async function fetchUserInfo(client: App["client"], userId: string): Promise<UserInfo | undefined> {
  // Bot IDs start with "B" — use bots.info instead of users.info (bots are not registry users)
  if (userId.startsWith("B")) {
    return getBotInfo(client, userId);
  }

  try {
    const result = await client.users.info({ user: userId });

    if (!result.ok || !result.user) {
      logger.debug(`Failed to fetch user info for ${userId}: ${result.error}`);
      return undefined;
    }

    const userInfo: UserInfo = {
      userId,
      username: result.user.name,
      displayName: result.user.profile?.display_name || result.user.profile?.real_name,
      isBot: result.user.is_bot === true,
      tz: result.user.tz ?? undefined,
    };

    userCache.set(userId, userInfo);
    await upsertIdentity(userId, registryDisplayName(userInfo), Date.now());
    logger.debug(`Cached user info for ${userId}: ${userInfo.displayName || userInfo.username}`);

    return userInfo;
  } catch (error) {
    if (isExpectedLookupError(error as SlackPlatformError)) {
      logger.debug(`User ${userId} not resolvable: ${(error as SlackPlatformError).data?.error}`);
      return undefined;
    }
    logger.error(`Error fetching user info for ${userId}:`, error);
    return undefined;
  }
}

function coalescedFetch(client: App["client"], userId: string): Promise<UserInfo | undefined> {
  const existing = inFlightFetches.get(userId);
  if (existing) {
    return existing;
  }
  const pending = fetchUserInfo(client, userId).finally(() => inFlightFetches.delete(userId));
  inFlightFetches.set(userId, pending);
  return pending;
}

/**
 * Registry-backed identity resolution with TTL-gated lazy refresh. Returns the persisted
 * identity when fresh; otherwise refreshes from Slack (coalescing concurrent calls), stamps
 * `lastFetched`, and persists. On a missing Slack client or a failed fetch, falls back to the
 * stale persisted record (or `null` when the user is wholly unknown) — never throws.
 */
export async function resolveUserIdentity(
  client: App["client"] | null,
  userId: string,
): Promise<UserIdentity | null> {
  const record = await getUserRecord(userId);
  const isFresh = record !== null && Date.now() - record.lastFetched <= DISPLAY_NAME_TTL_MS;
  if (record && isFresh) {
    return { userId, displayName: record.displayName };
  }

  if (!client) {
    return record ? { userId, displayName: record.displayName } : null;
  }

  const info = await coalescedFetch(client, userId);
  if (info) {
    return { userId, displayName: registryDisplayName(info) };
  }
  return record ? { userId, displayName: record.displayName } : null;
}

async function getBotInfo(client: App["client"], botId: string): Promise<UserInfo | undefined> {
  try {
    const result = await client.bots.info({ bot: botId });

    if (!result.ok || !result.bot) {
      logger.debug(`Failed to fetch bot info for ${botId}: ${result.error}`);
      return undefined;
    }

    const userInfo: UserInfo = {
      userId: botId,
      username: result.bot.name,
      displayName: result.bot.name,
      isBot: true,
    };

    userCache.set(botId, userInfo);
    logger.debug(`Cached bot info for ${botId}: ${userInfo.displayName}`);

    return userInfo;
  } catch (error) {
    if (isExpectedLookupError(error as SlackPlatformError)) {
      logger.debug(`Bot ${botId} not resolvable: ${(error as SlackPlatformError).data?.error}`);
      return undefined;
    }
    logger.error(`Error fetching bot info for ${botId}:`, error);
    return undefined;
  }
}

/**
 * Resolve multiple user IDs to user info.
 * Returns a map of userId -> UserInfo for successfully resolved users.
 */
export async function resolveUsers(
  client: App["client"],
  userIds: string[],
): Promise<Map<string, UserInfo>> {
  const results = new Map<string, UserInfo>();
  const uniqueIds = [...new Set(userIds)];

  // Resolve all users in parallel
  const promises = uniqueIds.map(async (userId) => {
    const info = await getUserInfo(client, userId);
    if (info) {
      results.set(userId, info);
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Clear the user cache. Useful for testing.
 */
export function clearUserCache(): void {
  userCache.clear();
  inFlightFetches.clear();
}

/**
 * Format user identity consistently.
 * Full format: [DisplayName (@username - ID: U12345678)]
 * Fallback: [ID: U12345678]
 */
export function formatUserIdentity(userId: string, userInfo?: UserInfo): string {
  if (userInfo?.displayName && userInfo?.username) {
    return `[${userInfo.displayName} (@${userInfo.username} - ID: ${userId})]`;
  }
  if (userInfo?.displayName) {
    return `[${userInfo.displayName} (ID: ${userId})]`;
  }
  if (userInfo?.username) {
    return `[@${userInfo.username} (ID: ${userId})]`;
  }
  return `[ID: ${userId}]`;
}

/**
 * Transform <@USERID> mentions in text to readable format.
 * Uses formatUserIdentity for consistent formatting.
 */
export async function transformUserMentions(client: App["client"], text: string): Promise<string> {
  // Match Slack user mentions: <@U12345678> or <@W12345678>
  const mentionPattern = /<@([UW][A-Z0-9]+)>/g;
  const matches = [...text.matchAll(mentionPattern)];

  if (matches.length === 0) {
    return text;
  }

  // Collect unique user IDs
  const userIds = [...new Set(matches.map((m) => m[1]))];

  // Resolve all users
  const userInfoMap = await resolveUsers(client, userIds);

  // Replace mentions with formatted identities
  let result = text;
  for (const [fullMatch, userId] of matches) {
    const userInfo = userInfoMap.get(userId);
    const formatted = formatUserIdentity(userId, userInfo);
    result = result.replace(fullMatch, formatted);
  }

  return result;
}
