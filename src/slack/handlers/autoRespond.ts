import type { App } from "@slack/bolt";
import { logger } from "../../logger.js";
import { findMatchingRule, loadRules } from "../../autoRespond.js";
import { extractAttachments } from "../fileExtractor.js";
import { processMessage } from "./core.js";

const AUTO_RESPOND_USER_ID = "auto-respond";

export function registerAutoRespondHandler(app: App): void {
  // Cache the bot's own user ID on first use
  let botUserId: string | undefined;

  app.event("message", async ({ event, client }) => {
    // Skip message subtypes (edits, deletes, joins, etc.) — only process regular new messages
    if ("subtype" in event && event.subtype !== undefined) {
      return;
    }

    // Skip thread replies — only trigger on top-level channel messages
    if ("thread_ts" in event && event.thread_ts !== undefined) {
      return;
    }

    // Early exit if no rules loaded
    const rules = await loadRules();
    if (rules.length === 0) {
      return;
    }

    // Resolve bot's own user ID (cached after first call)
    if (!botUserId) {
      const authResult = await client.auth.test();
      botUserId = authResult.user_id;
    }

    // Skip own messages
    const messageUser = "user" in event ? (event.user as string | undefined) : undefined;
    if (messageUser === botUserId) {
      return;
    }

    // Find the first matching rule
    const rawText = "text" in event ? (event.text as string | undefined) : undefined;
    const rule = await findMatchingRule(event.channel, messageUser, rawText);
    if (!rule) {
      return;
    }

    // Extract message text, falling back for attachment-only messages
    let messageText = rawText?.trim() || "Respond to this message";

    // Prepend extra context from the rule if configured
    if (rule.extraContext) {
      messageText = `[Context: ${rule.extraContext}]\n\n${messageText}`;
    }

    logger.info(
      `Auto-respond triggered: channel=${event.channel}, rule=${rule.id}, author=${messageUser ?? "unknown"}`
    );

    // Extract attachments if present
    const attachments = extractAttachments(
      "files" in event ? (event as unknown as { files?: unknown[] }).files : undefined
    );

    try {
      await processMessage({
        client,
        userId: messageUser ?? AUTO_RESPOND_USER_ID,
        channelId: event.channel,
        messageTs: event.ts,
        messageText,
        triggerType: "autoRespond",
        ...attachments,
      });
    } catch (error) {
      logger.error(
        `Auto-respond failed: channel=${event.channel}, rule=${rule.id}`,
        error
      );
    }
  });
}
