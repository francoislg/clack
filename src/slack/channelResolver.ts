import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";

/**
 * Narrow view of the Slack `WebClient` used by this module.
 *
 * Intentionally structural so tests can construct plain objects without
 * casting. The real `App["client"]` from `@slack/bolt` is structurally
 * assignable to this shape.
 */
export interface ChannelResolverClient {
  conversations: {
    open: (args: { users: string }) => Promise<{
      channel?: { id?: string } | null | undefined;
    }>;
    list: (args: { types: string; limit: number }) => Promise<{
      channels?: ReadonlyArray<{ id?: string; name?: string }> | undefined;
    }>;
  };
}

export function isChannelId(input: string): boolean {
  return /^[CGD][A-Z0-9_]+$/.test(input);
}

export function isUserId(input: string): boolean {
  return /^U[A-Z0-9_]+$/.test(input);
}

/**
 * Open (or retrieve) a DM channel with the given user. Returns the `D…`
 * channel ID, or `null` on failure. Logs errors internally so callers can
 * simply branch on null.
 */
export async function openDmChannel(
  client: ChannelResolverClient,
  userId: string,
): Promise<string | null> {
  try {
    const result = await client.conversations.open({ users: userId });
    return result.channel?.id ?? null;
  } catch (error) {
    logger.error(`Failed to open DM channel with ${userId}:`, error);
    return null;
  }
}

export interface ResolveChannelContext {
  client: ChannelResolverClient;
  /** The requesting user's Slack ID — used to enforce "self-only" on user-ID inputs. */
  userId: string;
}

export type ResolveChannelResult = { ok: true; channelId: string } | { ok: false; error: string };

/**
 * Resolve a channel-like identifier to a canonical Slack channel ID.
 *
 * Accepts:
 * - `#name` / `name` — looked up via `conversations.list`
 * - `C…` / `G…` / `D…` — passed through unchanged
 * - `U…` — only when it matches `ctx.userId`; opens a DM and returns the `D…` channel
 *
 * Third-party user IDs are rejected to prevent tools from DMing arbitrary users.
 */
export async function resolveChannelId(
  ctx: ResolveChannelContext,
  input: string,
): Promise<ResolveChannelResult> {
  if (isChannelId(input)) {
    return { ok: true, channelId: input };
  }

  if (isUserId(input)) {
    if (input !== ctx.userId) {
      return {
        ok: false,
        error:
          "This tool can only DM the requesting user. Pass the current channel ID or your own user ID.",
      };
    }
    const dmChannelId = await openDmChannel(ctx.client, input);
    if (!dmChannelId) {
      return { ok: false, error: `Failed to open DM channel with user ${input}` };
    }
    return { ok: true, channelId: dmChannelId };
  }

  const channelName = input.replace(/^#/, "");
  if (!channelName) {
    return { ok: false, error: `Invalid channel identifier: "${input}"` };
  }

  try {
    const listResult = await ctx.client.conversations.list({
      types: "public_channel,private_channel",
      limit: 1000,
    });
    const match = listResult.channels?.find((ch) => ch.name === channelName);
    if (!match?.id) {
      return {
        ok: false,
        error: `Could not find channel "${channelName}". Make sure the channel exists and the bot is a member.`,
      };
    }
    return { ok: true, channelId: match.id };
  } catch (error) {
    return { ok: false, error: `Failed to resolve channel name: ${errorMessage(error)}` };
  }
}
