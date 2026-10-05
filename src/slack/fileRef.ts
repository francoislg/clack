import type { App } from "@slack/bolt";

type SlackClient = App["client"];

/** A Slack file id. Canvases and Lists are files. */
export const SLACK_FILE_ID_PATTERN = /^F[A-Z0-9]{6,}$/;

export function isSlackHost(hostname: string): boolean {
  return hostname === "slack.com" || hostname.endsWith(".slack.com");
}

/** The path segments of a Slack URL; undefined when `ref` is not a URL on a Slack host. */
export function slackUrlSegments(ref: string): { segments: string[]; url: URL } | undefined {
  if (!URL.canParse(ref)) return undefined;
  const url = new URL(ref);
  if (!isSlackHost(url.hostname)) return undefined;

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  return { segments, url };
}

/** Whether a conversation is a DM or group DM (files cannot be shared to those). */
export async function isDirectConversation(
  client: SlackClient,
  channelId: string,
): Promise<boolean> {
  const response = await client.conversations.info({ channel: channelId });
  const channel = response?.channel;
  return channel?.is_im === true || channel?.is_mpim === true;
}
