import type { App } from "@slack/bolt";
import { logger } from "../logger.js";
import { buildWildcardMatcher } from "./wildcardMatcher.js";

export interface SlackUserEntry {
  userId: string;
  username: string;
  displayName: string;
}

export interface UsersCache {
  search(queries: string[], limit?: number): Promise<SlackUserEntry[]>;
}

function isRealUser(member: { deleted?: boolean; is_bot?: boolean; id?: string }): boolean {
  return !member.deleted && !member.is_bot && member.id !== "USLACKBOT";
}

function toUserEntry(member: {
  id?: string;
  name?: string;
  profile?: { display_name?: string; real_name?: string };
}): SlackUserEntry {
  return {
    userId: member.id ?? "",
    username: member.name ?? "",
    displayName: member.profile?.display_name || member.profile?.real_name || "",
  };
}

export function createUsersCache(client: App["client"]): UsersCache {
  let cached: SlackUserEntry[] | null = null;

  async function fetchAll(): Promise<SlackUserEntry[]> {
    if (cached) return cached;

    const users: SlackUserEntry[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.users.list({ limit: 1000, cursor });

      if (!result.ok || !result.members) {
        logger.error(`Failed to fetch users list: ${result.error}`);
        break;
      }

      for (const member of result.members) {
        if (isRealUser(member)) users.push(toUserEntry(member));
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    cached = users;
    logger.debug(`UsersCache: fetched and cached ${users.length} users`);
    return cached;
  }

  function matchesUser(
    user: SlackUserEntry,
    queries: string[],
    matchers: Array<(value: string) => boolean>,
  ): boolean {
    return matchers.some(
      (match, i) =>
        // userId is always exact (case-insensitive) — no wildcard/substring
        queries[i].toLowerCase() === user.userId.toLowerCase() ||
        match(user.username) ||
        match(user.displayName),
    );
  }

  return {
    async search(queries: string[], limit = 10): Promise<SlackUserEntry[]> {
      const users = await fetchAll();
      const matchers = queries.map(buildWildcardMatcher);
      const seen = new Set<string>();
      const results: SlackUserEntry[] = [];

      for (const user of users) {
        if (seen.has(user.userId)) continue;
        if (matchesUser(user, queries, matchers)) {
          seen.add(user.userId);
          results.push(user);
        }
      }

      return results.slice(0, limit);
    },
  };
}
