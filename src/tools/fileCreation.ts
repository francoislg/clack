import type { QueryToolContext } from "./types.js";
import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";

type SlackClient = NonNullable<QueryToolContext["slackClient"]>;

export interface ShareOutcome {
  sharedWith?: string;
  warning?: string;
}

/** Shares a new file with the session's channel unless that conversation is a DM or group DM. A failure is reported as a warning. */
export async function shareWithSessionChannel(opts: {
  client: SlackClient;
  fileId: string;
  channelId: string;
  isDirectConversation: (client: SlackClient, channelId: string) => Promise<boolean>;
  share: (client: SlackClient, fileId: string, channelId: string) => Promise<void>;
  errorMessage: (operation: string, error: unknown) => string;
}): Promise<ShareOutcome> {
  const { client, fileId, channelId } = opts;
  if (!channelId) return {};
  try {
    if (await opts.isDirectConversation(client, channelId)) return {};
  } catch (error) {
    return { warning: opts.errorMessage("check the channel before sharing", error) };
  }
  try {
    await opts.share(client, fileId, channelId);
    return { sharedWith: channelId };
  } catch (error) {
    return { warning: opts.errorMessage("share", error) };
  }
}

/** The file's permalink, or undefined when the lookup fails (logged). */
export async function permalinkOrUndefined(
  lookup: () => Promise<string | undefined>,
  logLabel: string,
): Promise<string | undefined> {
  try {
    return await lookup();
  } catch (error) {
    logger.warn(`${logLabel}: permalink lookup failed: ${errorMessage(error)}`);
    return undefined;
  }
}
