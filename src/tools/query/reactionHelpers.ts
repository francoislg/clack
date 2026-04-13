import { parseSlackMessageUrl } from "./fetchSlackMessage.js";

export function resolveReactionTarget(args: {
  url?: string;
  channel_id?: string;
  message_ts?: string;
}): { channel: string; timestamp: string } | { error: string } {
  if (args.url) {
    const parsed = parseSlackMessageUrl(args.url);
    if (!parsed) return { error: "Invalid Slack message URL format" };
    return { channel: parsed.channelId, timestamp: parsed.messageTs };
  }
  if (args.channel_id && args.message_ts) {
    return { channel: args.channel_id, timestamp: args.message_ts };
  }
  return {
    error: "Provide either a Slack message URL or both channel_id and message_ts",
  };
}
