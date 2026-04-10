import type { WebClient } from "@slack/web-api";
import { errorMessage } from "../errors.js";

/**
 * True when the input looks like a Slack channel/user ID that can be passed directly
 * to the Slack API without a name lookup.
 * C = public/private channel, G = group DM (legacy), D = DM channel,
 * U = user ID (caller must convert to DM channel via conversations.open).
 */
export function looksLikeSlackId(input: string): boolean {
  return /^[CGDU][A-Z0-9_]+$/.test(input);
}

/**
 * Resolve a channel name or ID to a channel ID.
 * If the input looks like a Slack channel ID (starts with C/G/D/U), returns it directly.
 * Otherwise, strips a leading # and searches conversations by name.
 */
export async function resolveChannelId(
  client: WebClient,
  channelInput: string,
): Promise<{ ok: true; channelId: string } | { ok: false; error: string }> {
  if (looksLikeSlackId(channelInput)) {
    return { ok: true, channelId: channelInput };
  }
  const channelName = channelInput.replace(/^#/, "");
  try {
    const listResult = await client.conversations.list({
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

/** MCP tool response envelope for successful results. */
export function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** MCP tool response envelope for error results. */
export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}
