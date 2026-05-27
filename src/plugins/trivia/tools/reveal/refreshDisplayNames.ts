import type { TriviaDataLayer, TriviaUser } from "../../core/types.js";
import type { PluginLogger } from "../../../sdk.js";

/**
 * Refresh stored display names against current Slack profiles for the given user
 * IDs, mutating `users` in place. Per-user fetch failures are logged and
 * swallowed — the stored value is left untouched so reveal rendering never
 * blocks on a transient Slack hiccup. Persists every change in a single
 * `data.saveUsers` call after all fetches resolve.
 *
 * Why batched: `saveUser` is a read-modify-write over the whole file. Fanning
 * out one `saveUser` per user via `Promise.all` would race — every concurrent
 * call reads the same baseline and only the last writer's changes survive.
 * `saveUsers` collapses them into a single atomic read-modify-write.
 *
 * Why this lives in the reveal flow: display names are stamped once when a
 * player first clicks an answer (`users.json` is global to the trivia plugin),
 * so a player who later changes their Slack name has a stale label on every
 * leaderboard until something else writes their record. The reveal is the
 * natural refresh point — it's the moment we render the player list publicly.
 */
export async function refreshUserDisplayNames(args: {
  userIds: Iterable<string>;
  users: Map<string, TriviaUser>;
  data: Pick<TriviaDataLayer, "saveUsers">;
  fetchDisplayName: (userId: string) => Promise<string | null>;
  logger: Pick<PluginLogger, "debug" | "warn">;
}): Promise<Map<string, TriviaUser>> {
  const { userIds, users, data, fetchDisplayName, logger } = args;
  const unique = [...new Set(userIds)];

  const updates: TriviaUser[] = [];

  await Promise.all(
    unique.map(async (userId) => {
      const existing = users.get(userId);
      if (!existing) return;
      let fetched: string | null;
      try {
        fetched = await fetchDisplayName(userId);
      } catch (err) {
        logger.warn(
          `refreshUserDisplayNames: failed to fetch display name for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      if (fetched === null || fetched === existing.displayName) return;
      const updated: TriviaUser = { ...existing, displayName: fetched };
      users.set(userId, updated);
      updates.push(updated);
      logger.debug(
        `refreshUserDisplayNames: ${userId} display name updated "${existing.displayName}" → "${fetched}"`,
      );
    }),
  );

  if (updates.length === 0) return users;

  try {
    await data.saveUsers(updates);
  } catch (err) {
    logger.warn(
      `refreshUserDisplayNames: failed to persist ${updates.length} display-name update(s): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return users;
}
