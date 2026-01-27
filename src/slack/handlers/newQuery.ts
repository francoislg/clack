import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getErrorBlocks } from "../blocks.js";
import { isDev } from "../../roles.js";
import type { ChangeRequest } from "../../changes/types.js";
import { getChangeEnabledRepos } from "../../changes/detection.js";
import { generateChangePlan } from "../../changes/execution.js";
import { startChangeWorkflow } from "../../changes/workflow.js";
import { processMessage } from "./core.js";

async function handleChangeReaction(
  client: App["client"],
  userId: string,
  channelId: string,
  messageTs: string,
  threadTs: string | undefined,
  messageText: string
): Promise<void> {
  const effectiveThreadTs = threadTs || messageTs;
  const config = getConfig();

  logger.debug(`Change reaction from user ${userId} in channel ${channelId}`);

  // Check if user has dev role
  const userIsDev = await isDev(userId);
  if (!userIsDev) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: "Change requests require dev permissions.",
    });
    return;
  }

  // Get available repositories
  const availableRepos = getChangeEnabledRepos(config);
  if (availableRepos.length === 0) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: "No repositories have changes enabled. Configure supportsChanges in config.",
    });
    return;
  }

  // Post acknowledgment message in thread
  const ackMessage = await client.chat.postMessage({
    channel: channelId,
    thread_ts: effectiveThreadTs,
    text: "Analyzing change request...",
  });

  // Generate the plan using Claude
  const planResult = await generateChangePlan(messageText, availableRepos);
  if (!planResult.success || !planResult.plan) {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `❌ Failed to create plan: ${planResult.error}`,
    });
    return;
  }

  const request: ChangeRequest = {
    userId,
    message: messageText,
    triggerType: "reactions",
    channel: channelId,
    messageTs,
    threadTs,
  };

  const result = await startChangeWorkflow(
    request,
    planResult.plan,
    effectiveThreadTs,
    async (progressMessage: string) => {
      try {
        await client.chat.update({
          channel: channelId,
          ts: ackMessage.ts!,
          text: progressMessage,
        });
      } catch (error) {
        logger.warn("Failed to update progress message:", error);
      }
    }
  );

  if (result.success) {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `✅ PR created: ${result.prUrl}\n\n${result.summary || ""}`.trim(),
    });
  } else {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `❌ Change request failed: ${result.error}`,
    });
  }
}

export function registerNewQueryHandler(app: App): void {
  const config = getConfig();

  // Get the change trigger emoji if configured
  const changeTrigger = config.reactions.changesWorkflow?.enabled
    ? config.reactions.changesWorkflow.trigger
    : null;

  app.event("reaction_added", async ({ event, client }) => {
    logger.debug(`Reaction event: ${event.reaction} from ${event.user}`);

    // Check if this is the change trigger emoji
    const isChangeTrigger = changeTrigger && event.reaction === changeTrigger;
    const isQueryTrigger = event.reaction === config.reactions.trigger;

    if (!isChangeTrigger && !isQueryTrigger) {
      logger.debug(`Ignoring reaction ${event.reaction}, waiting for ${config.reactions.trigger}${changeTrigger ? ` or ${changeTrigger}` : ""}`);
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
          actualMessageText = msg.text;
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
            actualMessageText = msg.text;
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
                actualMessageText = targetMsg.text;
                logger.debug(`Found message in thread replies`);
              }
            }
          }
        }
      } catch (error) {
        logger.error("Error fetching message:", error);
      }
    }

    // Route to the appropriate handler based on trigger type
    if (isChangeTrigger) {
      if (!actualMessageText) {
        await client.chat.postEphemeral({
          channel,
          user: userId,
          thread_ts: threadTs || ts,
          text: "Sorry, I couldn't read the message for the change request.",
        });
        return;
      }
      await handleChangeReaction(client, userId, channel, ts, threadTs, actualMessageText);
    } else {
      // Use unified flow for Q&A reactions
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

      await processMessage({
        client,
        userId,
        channelId: channel,
        messageTs: ts,
        messageText: actualMessageText,
        threadTs,
        triggerType: "reactions",
        responseStyle: "ephemeral",
      });
    }
  });
}
