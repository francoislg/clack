import type { App } from "@slack/bolt";
import { z } from "zod";
import { logger } from "../logger.js";

type SlackClient = App["client"];

/** The `conversations.info` fields that say whether the bot is in a conversation. A malformed
 *  value reads as absent, so a surprising shape never reads as membership. */
const membershipZod = z.object({
  is_member: z.boolean().optional().catch(undefined),
  is_im: z.boolean().optional().catch(undefined),
  is_mpim: z.boolean().optional().catch(undefined),
});

/** Whether the bot is in a conversation: a channel it is a member of, or a DM / group DM. A
 *  thrown error, a failed response or a missing channel reads as not in it. */
export async function isBotInConversation(client: SlackClient, channel: string): Promise<boolean> {
  try {
    const result = await client.conversations.info({ channel });
    if (!result.ok || !result.channel) return false;
    const parsed = membershipZod.safeParse(result.channel);
    if (!parsed.success) return false;
    const { is_member, is_im, is_mpim } = parsed.data;
    return is_member === true || is_im === true || is_mpim === true;
  } catch (error) {
    logger.warn(`botMembership: conversations.info failed for ${channel}: ${String(error)}`);
    return false;
  }
}
