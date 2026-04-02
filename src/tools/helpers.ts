import type { WebClient } from "@slack/web-api";
import { errorMessage } from "../errors.js";

/**
 * Resolve a channel name or ID to a channel ID.
 * If the input looks like a Slack channel ID (starts with C/G), returns it directly.
 * Otherwise, strips a leading # and searches conversations by name.
 */
export async function resolveChannelId(
  client: WebClient,
  channelInput: string,
): Promise<{ ok: true; channelId: string } | { ok: false; error: string }> {
  if (/^[CG][A-Z0-9_]+$/.test(channelInput)) {
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
