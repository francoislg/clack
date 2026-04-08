import type { App } from "@slack/bolt";
import { getChannelInfo } from "./channelCache.js";
import { getUserInfo } from "./userCache.js";

let cachedTeamUrl: string | undefined;

async function getTeamUrl(client: App["client"]): Promise<string> {
  if (cachedTeamUrl) return cachedTeamUrl;
  const result = await client.auth.test();
  // url is like "https://applauz.slack.com/" — strip trailing slash
  cachedTeamUrl = result.url?.replace(/\/$/, "") ?? "https://slack.com";
  return cachedTeamUrl;
}

/**
 * Returns a Slack deep link for a channel or message.
 * Returns empty string for DMs (not linkable).
 * Includes a leading space for easy appending to log lines.
 */
export async function slackLink(
  client: App["client"],
  channelId: string,
  ts?: string,
): Promise<string> {
  const info = await getChannelInfo(client, channelId);
  if (info?.isDm) return "";
  const base = await getTeamUrl(client);
  if (ts) {
    return ` ${base}/archives/${channelId}/p${ts.replace(".", "")}`;
  }
  return ` ${base}/archives/${channelId}`;
}

export async function resolveChannelLabel(
  client: App["client"],
  channelId: string,
): Promise<string> {
  const info = await getChannelInfo(client, channelId);
  if (!info) return channelId;
  return info.isDm ? info.name : `#${info.name}`;
}

export async function resolveUserLabel(client: App["client"], userId: string): Promise<string> {
  const info = await getUserInfo(client, userId);
  return info?.displayName ?? info?.username ?? userId;
}
