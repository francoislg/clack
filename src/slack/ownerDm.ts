import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { loadRoles } from "../roles.js";
import { getSlackClient } from "./app.js";
import { openDmChannel } from "./channelResolver.js";
import { unfurlOptions } from "./unfurlOptions.js";

/**
 * Slack user id of the workspace owner, or null when none is configured (or
 * roles can't be loaded). Never throws — a null owner means "nobody to notify".
 */
export async function getOwnerUserId(): Promise<string | null> {
  try {
    const roles = await loadRoles();
    return roles.owner;
  } catch (err) {
    logger.warn(`owner-dm: failed to load roles: ${errorMessage(err)}`);
    return null;
  }
}

/**
 * Open a DM with the owner and post the text. Best-effort: returns false on any
 * failure (no Slack client, DM channel rejected, post failed) and never throws,
 * so owner notification can't break the caller's flow.
 */
export async function sendOwnerDm(
  ownerUserId: string,
  text: string,
  options: { suppressUnfurls?: boolean } = {},
): Promise<boolean> {
  const client = getSlackClient();
  if (!client) {
    logger.warn(`owner-dm: no Slack client available`);
    return false;
  }
  const dmChannel = await openDmChannel(client, ownerUserId);
  if (!dmChannel) return false; // openDmChannel logs internally
  try {
    await client.chat.postMessage({
      channel: dmChannel,
      text,
      ...unfurlOptions(options.suppressUnfurls),
    });
    return true;
  } catch (err) {
    logger.warn(`owner-dm: failed to post DM to owner ${ownerUserId}: ${errorMessage(err)}`);
    return false;
  }
}
