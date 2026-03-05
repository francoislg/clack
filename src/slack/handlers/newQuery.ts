import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getErrorBlocks } from "../blocks.js";
import { isDev } from "../../roles.js";
import { extractMessageText } from "../messagesApi.js";
import { processMessage } from "./core.js";

export function registerNewQueryHandler(app: App): void {
  const config = getConfig();

  // Get the work-mode trigger emoji if configured
  const workTrigger = config.reactions.changesWorkflow?.enabled
    ? config.reactions.changesWorkflow.trigger
    : null;

  app.event("reaction_added", async ({ event, client }) => {
    logger.debug(`Reaction event: ${event.reaction} from ${event.user}`);

    // Check if this is the work-mode or query trigger emoji
    const isWorkTrigger = workTrigger && event.reaction === workTrigger;
    const isQueryTrigger = event.reaction === config.reactions.trigger;

    if (!isWorkTrigger && !isQueryTrigger) {
      logger.debug(`Ignoring reaction ${event.reaction}, waiting for ${config.reactions.trigger}${workTrigger ? ` or ${workTrigger}` : ""}`);
      return;
    }

    if (event.item.type !== "message") {
      logger.debug("Ignoring non-message reaction");
      return;
    }

    const { channel, ts } = event.item;
    const userId = event.user;

    // Detect thread context and fetch the actual message
    // Note: reaction_added doesn't include thread_ts, so we need to figure it out
    let threadTs: string | undefined;
    let actualMessageText: string | undefined;

    try {
      // Step 1: Try conversations.replies first - this works if ts is a parent message
      const repliesResult = await client.conversations.replies({
        channel,
        ts: ts,
        inclusive: true,
        limit: 1,
      });

      if (repliesResult.messages && repliesResult.messages.length > 0) {
        const msg = repliesResult.messages[0];
        if (msg.ts === ts) {
          // ts is a parent message - we found it directly
          threadTs = msg.thread_ts || ts;
          actualMessageText = extractMessageText(msg);
          logger.debug(`Found message via conversations.replies (parent message)`);
        }
      }
    } catch (error) {
      // conversations.replies failed - ts might be a reply, not a parent
      // Or it's a channel-level message with no thread
      logger.debug("conversations.replies failed, trying history approach:", error);
    }

    if (!actualMessageText) {
      // Step 2: Fallback - try conversations.history for channel-level messages
      try {
        const histResult = await client.conversations.history({
          channel,
          latest: ts,
          inclusive: true,
          limit: 1,
        });

        if (histResult.messages && histResult.messages.length > 0) {
          const msg = histResult.messages[0];
          if (msg.ts === ts) {
            // Found the exact message in channel history
            threadTs = msg.thread_ts;
            actualMessageText = extractMessageText(msg);
            logger.debug(`Found message via conversations.history (channel message)`);
          } else if (msg.thread_ts) {
            // Didn't find exact match - ts might be a thread reply
            // The returned message's thread_ts points to the parent thread
            // We need to search in that thread
            logger.debug(`Message not in channel history, searching in thread ${msg.thread_ts}`);
            threadTs = msg.thread_ts;

            // Fetch from the thread to find our actual message
            const threadResult = await client.conversations.replies({
              channel,
              ts: threadTs,
              limit: 100,
            });

            if (threadResult.messages) {
              const targetMsg = threadResult.messages.find((m) => m.ts === ts);
              if (targetMsg) {
                actualMessageText = extractMessageText(targetMsg);
                logger.debug(`Found message in thread replies`);
              }
            }
          }
        }
      } catch (error) {
        logger.error("Error fetching message:", error);
      }
    }

    if (!actualMessageText) {
      await client.chat.postEphemeral({
        channel,
        user: userId,
        thread_ts: threadTs || ts,
        text: "Sorry, I couldn't read the message. Make sure I'm invited to this channel.",
        blocks: getErrorBlocks("Sorry, I couldn't read the message. Make sure I'm invited to this channel."),
      });
      return;
    }

    // Determine work mode: work trigger + dev role = workMode, otherwise standard Q&A
    let workMode = false;
    if (isWorkTrigger) {
      workMode = await isDev(userId);
    }

    await processMessage({
      client,
      userId,
      channelId: channel,
      messageTs: ts,
      messageText: actualMessageText,
      threadTs,
      triggerType: "reactions",
      workMode,
    });
  });
}
