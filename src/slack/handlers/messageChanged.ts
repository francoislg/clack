import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
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

/**
 * Determine if an edited message should restart the in-flight request.
 * Returns the cleaned text to restart with, or null if no restart is needed.
 */
async function resolveRestartText(
  client: App["client"],
  triggerType: string,
  newText: string,
): Promise<string | null> {
  if (triggerType === "mentions") {
    const botUserId = await getBotUserId(client);
    if (!new RegExp(`<@${botUserId}>`).test(newText)) return null;
    const cleanText = newText.replace(new RegExp(`<@${botUserId}>\\s*`, "g"), "").trim();
    return cleanText || null;
  }
  if (triggerType === "directMessages") {
    return newText.trim() || null;
  }
  return null;
}

interface MessageChangedEvent {
  subtype?: string;
  channel: string;
  channel_type?: string;
  message?: { ts: string; text?: string; user?: string };
  previous_message?: { ts: string; text?: string; user?: string };
}

/**
 * Handle a message_changed event: abort any in-flight request and optionally
 * restart with the edited text.
 */
async function handleMessageChanged(
  msg: MessageChangedEvent,
  client: App["client"],
): Promise<void> {
  const { channel } = msg;
  const messageTs = msg.message?.ts;
  const newText = msg.message?.text ?? "";

  if (!messageTs) return;

  // Ignore metadata-only changes (e.g. URL unfurls) where the text hasn't changed
  if (newText === (msg.previous_message?.text ?? "")) return;

  // Look up in-flight request — if not found, Claude already finished
  const inFlight = getInFlightRequest(channel, messageTs);
  if (!inFlight) return;

  logger.info(
    `Message edited while in-flight (session: ${inFlight.sessionId}, trigger: ${inFlight.triggerType})`,
  );

  // Deregister before aborting to prevent race conditions
  deregisterInFlightRequest(channel, messageTs);
  inFlight.abortController.abort();

  // Determine whether to restart with the edited text
  const restartText = await resolveRestartText(client, inFlight.triggerType, newText);
  if (restartText) {
    logger.info(
      `Restarting ${inFlight.triggerType} request with edited text (session: ${inFlight.sessionId})`,
    );
    await processMessage({
      client,
      userId: msg.message!.user!,
      channelId: channel,
      messageTs,
      messageText: restartText,
      triggerType: inFlight.triggerType,
    });
  } else {
    logger.info(`Edit cancelled without restart (session: ${inFlight.sessionId})`);
  }
}

export function registerMessageChangedHandler(app: App): void {
  app.event("message", async ({ event, client }) => {
    const config = getConfig();
    if (!config.directMessages.enabled && !config.mentions.enabled) return;

    const msg = event as MessageChangedEvent;
    if (msg.subtype !== "message_changed") return;
    await handleMessageChanged(msg, client);
  });
}
