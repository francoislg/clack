import type { App } from "@slack/bolt";
import type {
  ConversationsHistoryResponse,
  AuthTestResponse,
  UsersInfoResponse,
} from "@slack/web-api";
import type { SlackReactionLike } from "./types.js";

/**
 * Slack platform error codes that mean "this user can't be resolved by this
 * bot" — expected outcomes (deactivated users, external Slack Connect users,
 * cross-workspace IDs), not operational failures. The SDK throws for these
 * rather than returning `{ ok: false }`, so we catch and normalize to `null` —
 * otherwise a single deactivated player produces a warn log on every reveal.
 */
const EXPECTED_USER_LOOKUP_ERRORS = new Set([
  "user_not_found",
  "user_not_visible",
  "bot_not_found",
]);

/**
 * Exported for direct testing. Detects Slack's "this user can't be resolved"
 * platform errors structurally — `error.data.error` is a string in the
 * EXPECTED_USER_LOOKUP_ERRORS set. Tolerates non-Error throws, errors without
 * `.data`, and non-string error codes (all return false).
 */
export function isExpectedUserLookupError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  if (!("data" in error)) return false;
  const data = error.data;
  if (data === null || typeof data !== "object") return false;
  if (!("error" in data)) return false;
  const code = data.error;
  return typeof code === "string" && EXPECTED_USER_LOOKUP_ERRORS.has(code);
}

// Slack SDK shapes derived from the typed response.
type HistoryMessage = NonNullable<ConversationsHistoryResponse["messages"]>[number];
type SlackReaction = NonNullable<HistoryMessage["reactions"]>[number];

/**
 * Parse the Slack `ts` (string form, like `"1234567890.123456"`) out of a permalink.
 * Slack permalinks embed the message ts as `/p<digits>` where `<digits>` is the ts
 * with the dot removed (10-digit seconds + 6-digit microseconds).
 */
export function parseTsFromPermalink(link: string): string | null {
  const match = link.match(/\/p(\d{10,})/);
  if (!match) return null;
  const digits = match[1];
  return `${digits.slice(0, 10)}.${digits.slice(10).padEnd(6, "0")}`;
}

/** Channel ID is the segment immediately after `/archives/` in a Slack permalink. */
export function parseChannelFromPermalink(link: string): string | null {
  const match = link.match(/\/archives\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch the named message's reactions via `conversations.history` with `inclusive: true`,
 * keyed on the exact `ts` so we get only that one message. Returns a normalized
 * `SlackReactionLike[]` (drops malformed entries silently).
 */
export async function fetchMessageReactions(
  client: App["client"],
  channel: string,
  ts: string,
): Promise<SlackReactionLike[]> {
  const resp = await client.conversations.history({
    channel,
    inclusive: true,
    latest: ts,
    oldest: ts,
    limit: 1,
  });
  const msg: HistoryMessage | undefined = resp.messages?.[0];
  if (msg === undefined) {
    throw new Error(`Slack message ts=${ts} not found in channel ${channel}`);
  }
  const raw: SlackReaction[] = msg.reactions ?? [];
  return normalizeReactions(raw);
}

/**
 * Strip Slack's `::skin-tone-N` suffix(es) from a reaction name so
 * `+1::skin-tone-4` categorizes as `+1`. Multi-person emojis (kiss,
 * couple_with_heart…) can chain two modifiers, e.g. `kiss::skin-tone-2::skin-tone-4`,
 * so we strip any number of trailing skin-tone segments.
 */
export function stripSkinTone(name: string): string {
  return name.replace(/(?:::skin-tone-\d+)+$/, "");
}

/**
 * Public for testing — normalize the raw Slack-SDK reaction shape into our internal
 * `SlackReactionLike[]`, dropping any entry without a string `name` and filtering
 * non-string user IDs. Skin-tone variants are folded into their base emoji and
 * duplicate users across variants are de-duplicated.
 */
export function normalizeReactions(raw: SlackReaction[]): SlackReactionLike[] {
  const order: string[] = [];
  const byEmoji = new Map<string, Set<string>>();
  for (const r of raw) {
    if (typeof r.name !== "string") continue;
    const emoji = stripSkinTone(r.name);
    const users = Array.isArray(r.users)
      ? r.users.filter((u): u is string => typeof u === "string")
      : [];
    let set = byEmoji.get(emoji);
    if (set === undefined) {
      set = new Set<string>();
      byEmoji.set(emoji, set);
      order.push(emoji);
    }
    for (const u of users) set.add(u);
  }
  return order.map((emoji) => ({ emoji, users: [...(byEmoji.get(emoji) ?? [])] }));
}

/**
 * Resolve the bot's Slack user ID via `auth.test`. Returns `""` if `user_id` is
 * absent (legacy responses sometimes omit it on certain auth modes — callers
 * treat empty as "no bot exclusion possible").
 */
export async function fetchBotUserId(client: App["client"]): Promise<string> {
  const auth: AuthTestResponse = await client.auth.test();
  return typeof auth.user_id === "string" ? auth.user_id : "";
}

/**
 * Resolve a user's current Slack display name via `users.info`. Prefers
 * `profile.display_name` (the "what other people call me" field), falls back to
 * `profile.real_name`, then `name`. Returns `null` when the user can't be
 * resolved (deactivated, deleted, external) so the caller can leave the stored
 * value untouched.
 */
export async function fetchUserDisplayName(
  client: App["client"],
  userId: string,
): Promise<string | null> {
  let resp: UsersInfoResponse;
  try {
    resp = await client.users.info({ user: userId });
  } catch (err) {
    if (isExpectedUserLookupError(err)) return null;
    throw err;
  }
  if (!resp.ok || !resp.user) return null;
  const profile = resp.user.profile;
  const candidate = profile?.display_name || profile?.real_name || resp.user.name;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}
