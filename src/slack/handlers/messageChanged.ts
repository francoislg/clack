import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getForChannelMessage as getActiveRunForChannelMessage } from "../activeRuns.js";
import { findSessionByThread } from "../../sessions.js";
import { processMessage } from "./core.js";
import { getBotUserId } from "../botIdentity.js";

export interface MessageChangedDeps {
  getConfig: typeof getConfig;
  getActiveRunForChannelMessage: typeof getActiveRunForChannelMessage;
  findSessionByThread: typeof findSessionByThread;
  processMessage: typeof processMessage;
}

export const defaultMessageChangedDeps: MessageChangedDeps = {
  getConfig,
  getActiveRunForChannelMessage,
  findSessionByThread,
  processMessage,
};

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
  message?: {
    ts: string;
    text?: string;
    user?: string;
    bot_id?: string;
    thread_ts?: string;
  };
  previous_message?: { ts: string; text?: string; user?: string };
}

/**
 * Handle a message_changed event: stop any active run for the thread and optionally
 * restart with the edited text. Run lookups go through the active-runs registry, which is
 * keyed by `(channelId, threadTs)`. For top-level edits, `threadTs === messageTs`.
 */
async function handleMessageChanged(
  msg: MessageChangedEvent,
  client: App["client"],
  deps: MessageChangedDeps,
): Promise<void> {
  const { channel } = msg;
  const messageTs = msg.message?.ts;
  const newText = msg.message?.text ?? "";

  if (!messageTs) return;

  // CRITICAL: ignore edits to the bot's OWN messages. While streaming a response Clack
  // updates its placeholder message many times, and each update fires a `message_changed`
  // event in the same DM/thread. Without this guard the handler would treat each placeholder
  // edit as a new user follow-up and queue it onto the session, causing the bot to respond
  // to its own streaming output in a runaway loop.
  const editorUserId = msg.message?.user;
  const editorBotId = msg.message?.bot_id;
  if (editorBotId) return;
  if (editorUserId) {
    const botUserId = await getBotUserId(client);
    if (editorUserId === botUserId) return;
  }

  // Ignore metadata-only changes (e.g. URL unfurls) where the text hasn't changed
  if (newText === (msg.previous_message?.text ?? "")) return;

  // For top-level edits the message ts is also the thread root; for reply edits the
  // thread root is on the event payload.
  const threadTs = msg.message?.thread_ts ?? messageTs;

  const handle = deps.getActiveRunForChannelMessage(channel, threadTs, editorUserId);
  if (!handle || handle.status !== "running") {
    // No run is in flight — there's nothing for an edit to append to. We deliberately do
    // NOT spawn a fresh run for an edit; if the user wants a new turn, they should send a
    // new message rather than edit the previous one (which the model has already
    // consumed).
    return;
  }

  const session = await deps.findSessionByThread(channel, threadTs);
  if (!session) return;
  const triggerType = session.triggerType ?? "mentions";

  const appendText = await resolveRestartText(client, triggerType, newText);
  if (!appendText) {
    logger.info(`Edit ignored (session: ${session.sessionId}): no usable text after cleaning`);
    return;
  }

  // Push the edited text into the live SDK Query as a follow-up user message. The SDK
  // delivers it to the model after the current turn completes (first-result-wins: if the
  // run produces its first `result` before the SDK reads this push, the message is
  // silently dropped, which is acceptable for edits — they are a "while you're at it"
  // kind of input, not a guaranteed-delivery channel).
  try {
    await handle.sendUpdate(appendText);
    logger.info(
      `Appended edited text onto live run (session: ${session.sessionId}, trigger: ${triggerType})`,
    );
  } catch (err) {
    logger.info(
      `Edit append failed (session: ${session.sessionId}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function registerMessageChangedHandler(
  app: App,
  deps: MessageChangedDeps = defaultMessageChangedDeps,
): void {
  app.event("message", async ({ event, client }) => {
    const config = deps.getConfig();
    if (!config.directMessages.enabled && !config.mentions.enabled) return;

    const msg = event as MessageChangedEvent;
    if (msg.subtype !== "message_changed") return;
    await handleMessageChanged(msg, client, deps);
  });
}
