import type { App, SlackEventMiddlewareArgs } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { handleFollowedThreadEvent } from "../../investigations/engine.js";

type MessageEvent = SlackEventMiddlewareArgs<"message">["event"];

/**
 * Non-destructive tee: a second `message` listener (alongside auto-respond) that routes events
 * in followed threads to the investigation follow pipeline. Bolt fires every registered
 * listener, so auto-respond, mentions, and stop detection observe the same event unchanged.
 */
export async function handleInvestigationMessageEvent(
  event: MessageEvent,
  client: App["client"],
): Promise<void> {
  if (!getConfig().investigations?.enabled) return;

  const threadTs =
    "thread_ts" in event && typeof event.thread_ts === "string" ? event.thread_ts : undefined;
  if (!threadTs) return;

  const userId = "user" in event && typeof event.user === "string" ? event.user : undefined;
  const botId = "bot_id" in event && typeof event.bot_id === "string" ? event.bot_id : undefined;
  const subtype =
    "subtype" in event && typeof event.subtype === "string" ? event.subtype : undefined;
  const text = "text" in event && typeof event.text === "string" ? event.text : undefined;

  try {
    await handleFollowedThreadEvent(client, {
      channel: event.channel,
      threadTs,
      ...(userId ? { userId } : {}),
      ...(botId ? { botId } : {}),
      ...(subtype ? { subtype } : {}),
      ...(text ? { text } : {}),
    });
  } catch (err) {
    logger.warn(`investigation follow pipeline error: ${String(err)}`);
  }
}

export function registerInvestigationFollowHandler(app: App): void {
  app.event("message", async ({ event, client }) => {
    await handleInvestigationMessageEvent(event, client);
  });
}
