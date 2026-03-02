import type { App } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getInFlightRequest, deregisterInFlightRequest } from "../inFlightRequests.js";
import { processMessage } from "./core.js";

let cachedBotUserId: string | undefined;

async function getBotUserId(client: App["client"]): Promise<string> {
  if (!cachedBotUserId) {
    const result = await client.auth.test();
    cachedBotUserId = result.user_id!;
  }
  return cachedBotUserId;
}

export function registerMessageChangedHandler(app: App): void {
  app.event("message", async ({ event, client }) => {
    const msg = event as {
      subtype?: string;
      channel: string;
      channel_type?: string;
      message?: { ts: string; text?: string; user?: string };
      previous_message?: { ts: string; text?: string; user?: string };
    };

    if (msg.subtype !== "message_changed") {
      return;
    }

    const channel = msg.channel;
    const messageTs = msg.message?.ts;
    const newText = msg.message?.text ?? "";

    if (!messageTs) {
      return;
    }

    // Look up in-flight request — if not found, Claude already finished (ignore)
    const inFlight = getInFlightRequest(channel, messageTs);
    if (!inFlight) {
      return;
    }

    logger.info(`Message edited while in-flight (session: ${inFlight.sessionId}, trigger: ${inFlight.triggerType})`);

    // Deregister before aborting to prevent race conditions
    deregisterInFlightRequest(channel, messageTs);
    inFlight.abortController.abort();

    // Clean up thinking indicator
    const { thinkingState } = inFlight;
    if (thinkingState.usedEmoji && thinkingState.emoji) {
      try {
        await client.reactions.remove({
          channel,
          timestamp: messageTs,
          name: thinkingState.emoji,
        });
      } catch {
        // Emoji may have already been removed
      }
    } else if (thinkingState.messageTs) {
      try {
        await client.chat.delete({
          channel,
          ts: thinkingState.messageTs,
        });
      } catch {
        // Message may have already been deleted
      }
    }

    // Determine whether to restart
    const botUserId = await getBotUserId(client);

    if (inFlight.triggerType === "mentions") {
      const mentionPattern = new RegExp(`<@${botUserId}>`);
      if (mentionPattern.test(newText)) {
        // Still mentioned — restart with updated text
        const cleanText = newText.replace(new RegExp(`<@${botUserId}>\\s*`, "g"), "").trim();
        if (cleanText) {
          logger.info(`Restarting mention request with edited text (session: ${inFlight.sessionId})`);
          await processMessage({
            client,
            userId: msg.message!.user!,
            channelId: channel,
            messageTs,
            messageText: cleanText,
            triggerType: "mentions",
          });
        }
      } else {
        logger.info(`Bot mention removed — cancelled without restart (session: ${inFlight.sessionId})`);
      }
    } else if (inFlight.triggerType === "directMessages") {
      if (newText.trim()) {
        logger.info(`Restarting DM request with edited text (session: ${inFlight.sessionId})`);
        await processMessage({
          client,
          userId: msg.message!.user!,
          channelId: channel,
          messageTs,
          messageText: newText.trim(),
          triggerType: "directMessages",
        });
      } else {
        logger.info(`DM edited to empty — cancelled without restart (session: ${inFlight.sessionId})`);
      }
    }
  });
}
