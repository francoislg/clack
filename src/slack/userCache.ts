import type { App } from "@slack/bolt";
import { logger } from "../logger.js";

export interface UserInfo {
  userId: string;
  username?: string;
  displayName?: string;
}

const userCache = new Map<string, UserInfo>();

/**
 * Get user info from cache or fetch from Slack API.
 * Returns undefined if the user cannot be resolved.
 */
export async function getUserInfo(
  client: App["client"],
  userId: string
): Promise<UserInfo | undefined> {
  // Return cached value if present
  const cached = userCache.get(userId);
  if (cached) {
    return cached;
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
    };

    // Cache the result
    userCache.set(userId, userInfo);
    logger.debug(`Cached user info for ${userId}: ${userInfo.displayName || userInfo.username}`);

    return userInfo;
  } catch (error) {
    logger.error(`Error fetching user info for ${userId}:`, error);
    return undefined;
  }
}

/**
 * Resolve multiple user IDs to user info.
 * Returns a map of userId -> UserInfo for successfully resolved users.
 */
export async function resolveUsers(
  client: App["client"],
  userIds: string[]
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
export async function transformUserMentions(
  client: App["client"],
  text: string
): Promise<string> {
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
