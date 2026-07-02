import type { App } from "@slack/bolt";
import { logger } from "../logger.js";
import type { JsonObject } from "../config.js";
import { getUserRecord, type UserRecord } from "../userRegistry.js";
import { buildWildcardMatcher } from "./wildcardMatcher.js";

export interface SlackUserEntry {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  github?: { username: string };
  plugins?: { [pluginName: string]: JsonObject };
}

/** Narrow read surface into the user registry — injected so tests stub it without touching disk. */
export interface UserRegistryReader {
  getUserRecord: (userId: string) => Promise<UserRecord | null>;
}

export const defaultUserRegistryReader: UserRegistryReader = { getUserRecord };

export interface UserSearchOptions {
  offset?: number;
  limit?: number;
  /** Plugin namespaces to project onto each result — the tool authorizes these before passing them in. */
  includePluginData?: string[];
}

export interface UserSearchResult {
  entries: SlackUserEntry[];
  /** Total matches across the whole roster, independent of offset/limit. */
  totalMatched: number;
}

export interface UsersCache {
  search(queries: string[], options?: UserSearchOptions): Promise<UserSearchResult>;
}

function isRealUser(member: { deleted?: boolean; is_bot?: boolean; id?: string }): boolean {
  return !member.deleted && !member.is_bot && member.id !== "USLACKBOT";
}

function toUserEntry(member: {
  id?: string;
  name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    image_original?: string;
    image_512?: string;
  };
}): SlackUserEntry {
  return {
    userId: member.id ?? "",
    username: member.name ?? "",
    displayName: member.profile?.display_name || member.profile?.real_name || "",
    // image_512 is always synthesized by Slack; image_original exists only for custom uploads.
    avatarUrl: member.profile?.image_original || member.profile?.image_512 || "",
  };
}

export function createUsersCache(
  client: App["client"],
  registry: UserRegistryReader = defaultUserRegistryReader,
): UsersCache {
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

  // Left-join registry attributes onto a roster entry. Never throws — a missing or malformed
  // record simply yields no enrichment (the registry reader is graceful, and we guard anyway).
  async function enrich(
    user: SlackUserEntry,
    includePluginData: string[],
  ): Promise<SlackUserEntry> {
    let record: UserRecord | null = null;
    try {
      record = await registry.getUserRecord(user.userId);
    } catch (error) {
      logger.debug(`UsersCache: registry enrichment failed for ${user.userId}: ${error}`);
    }
    if (!record) return user;

    const enriched: SlackUserEntry = { ...user };
    if (record.github) enriched.github = record.github;

    if (includePluginData.length > 0 && record.plugins) {
      const projected: { [pluginName: string]: JsonObject } = {};
      for (const name of includePluginData) {
        const namespace = record.plugins[name];
        if (namespace !== undefined) projected[name] = namespace;
      }
      if (Object.keys(projected).length > 0) enriched.plugins = projected;
    }
    return enriched;
  }

  return {
    async search(queries: string[], options: UserSearchOptions = {}): Promise<UserSearchResult> {
      const offset = Math.max(0, options.offset ?? 0);
      const limit = options.limit && options.limit > 0 ? options.limit : 10;
      const includePluginData = options.includePluginData ?? [];

      const users = await fetchAll();
      const matchers = queries.map(buildWildcardMatcher);
      const seen = new Set<string>();
      const matches: SlackUserEntry[] = [];

      for (const user of users) {
        if (seen.has(user.userId)) continue;
        if (matchesUser(user, queries, matchers)) {
          seen.add(user.userId);
          matches.push(user);
        }
      }

      // Enrich only the returned page, so registry reads stay bounded by `limit`.
      const page = matches.slice(offset, offset + limit);
      const entries = await Promise.all(page.map((user) => enrich(user, includePluginData)));
      return { entries, totalMatched: matches.length };
    },
  };
}
