import type { App } from "@slack/bolt";
import type { JsonObject } from "../config.js";
import { listUserRecords, type UserRecord } from "../userRegistry.js";
import { buildWildcardMatcher } from "./wildcardMatcher.js";
import { ensureRosterFresh as defaultEnsureRosterFresh } from "./rosterSync.js";

export interface SlackUserEntry {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  github?: { username: string };
  otherNames?: string[];
  plugins?: { [pluginName: string]: JsonObject };
}

/** Narrow read surface into the registry — injected so tests supply records without touching disk. */
export interface UserRegistryReader {
  listUserRecords: () => Promise<UserRecord[]>;
}

export const defaultUserRegistryReader: UserRegistryReader = { listUserRecords };

export interface UsersCacheDeps {
  registry?: UserRegistryReader;
  /** TTL-gated roster refresh; injected so unit tests run without a Slack roster fetch. */
  ensureRosterFresh?: (client: App["client"] | null) => Promise<void>;
}

export interface UserSearchOptions {
  offset?: number;
  limit?: number;
  /** Plugin namespaces to project onto each result — the tool authorizes these before passing them in. */
  includePluginData?: string[];
}

export interface UserSearchResult {
  entries: SlackUserEntry[];
  /** Total matches across the whole registry, independent of offset/limit. */
  totalMatched: number;
}

export interface UsersCache {
  search(queries: string[], options?: UserSearchOptions): Promise<UserSearchResult>;
}

// A Slack-sourced field absent on a not-yet-synced record (e.g. an `update_user` placeholder) reads
// as the empty string, so the entry shape is stable regardless of sync state.
function baseEntry(record: UserRecord): SlackUserEntry {
  const entry: SlackUserEntry = {
    userId: record.userId,
    username: record.username ?? "",
    displayName: record.displayName ?? "",
    avatarUrl: record.avatarUrl ?? "",
  };
  if (record.github) entry.github = record.github;
  if (record.otherNames && record.otherNames.length > 0) entry.otherNames = record.otherNames;
  return entry;
}

function recordMatches(
  record: UserRecord,
  queries: string[],
  matchers: Array<(value: string) => boolean>,
): boolean {
  return matchers.some(
    (match, i) =>
      // userId is always exact (case-insensitive) — no wildcard/substring
      queries[i].toLowerCase() === record.userId.toLowerCase() ||
      match(record.username ?? "") ||
      match(record.displayName ?? "") ||
      (record.github ? match(record.github.username) : false) ||
      (record.otherNames?.some((name) => match(name)) ?? false),
  );
}

function projectPlugins(record: UserRecord, includePluginData: string[]): SlackUserEntry {
  const entry = baseEntry(record);
  if (includePluginData.length > 0 && record.plugins) {
    const projected: { [pluginName: string]: JsonObject } = {};
    for (const name of includePluginData) {
      const namespace = record.plugins[name];
      if (namespace !== undefined) projected[name] = namespace;
    }
    if (Object.keys(projected).length > 0) entry.plugins = projected;
  }
  return entry;
}

export function createUsersCache(client: App["client"], deps: UsersCacheDeps = {}): UsersCache {
  const registry = deps.registry ?? defaultUserRegistryReader;
  const ensureRosterFresh = deps.ensureRosterFresh ?? defaultEnsureRosterFresh;

  return {
    async search(queries: string[], options: UserSearchOptions = {}): Promise<UserSearchResult> {
      const offset = Math.max(0, options.offset ?? 0);
      const limit = options.limit && options.limit > 0 ? options.limit : 10;
      const includePluginData = options.includePluginData ?? [];

      // Keep the registry current before searching it (cold-await / stale-background / fresh-skip).
      await ensureRosterFresh(client);

      const records = await registry.listUserRecords();
      const matchers = queries.map(buildWildcardMatcher);
      const seen = new Set<string>();
      const matches: UserRecord[] = [];

      for (const record of records) {
        if (seen.has(record.userId)) continue;
        if (recordMatches(record, queries, matchers)) {
          seen.add(record.userId);
          matches.push(record);
        }
      }

      // Project plugin data only on the returned page.
      const page = matches.slice(offset, offset + limit);
      const entries = page.map((record) => projectPlugins(record, includePluginData));
      return { entries, totalMatched: matches.length };
    },
  };
}
