import type { App } from "@slack/bolt";
import { logger } from "../../logger.js";
import { findMatchingRule, loadRules } from "../../autoRespond.js";
import { runPreAnalysis } from "../../claude/preAnalysis.js";
import { loadPreAnalysisContext } from "../../configurationFiles.js";
import { extractAttachments } from "../fileExtractor.js";
import { processMessage } from "./core.js";

const AUTO_RESPOND_USER_ID = "auto-respond";

export function registerAutoRespondHandler(app: App): void {
  // Cache the bot's own IDs on first use
  let botUserId: string | undefined;
  let botId: string | undefined;

  app.event("message", async ({ event, client }) => {
    // Skip non-message subtypes (edits, deletes, joins, etc.) — but allow bot_message through
    if ("subtype" in event && event.subtype !== undefined && event.subtype !== "bot_message") {
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
      botId = authResult.bot_id;
    }

    // Skip own messages (by user ID or bot ID)
    const messageUser = "user" in event ? (event.user as string | undefined) : undefined;
    if (messageUser === botUserId) {
      return;
    }

    const messageBotId = "bot_id" in event ? (event as unknown as { bot_id: string }).bot_id : undefined;
    if (messageBotId && messageBotId === botId) {
      return;
    }

    // Skip messages that @mention the bot — handled by the mention handler
    const rawText = "text" in event ? (event.text as string | undefined) : undefined;
    if (rawText && botUserId && rawText.includes(`<@${botUserId}>`)) {
      return;
    }

    // Find the first matching rule
    const rule = await findMatchingRule(event.channel, messageUser, rawText);
    if (!rule) {
      return;
    }

    // Run pre-analysis gate if configured
    if (rule.preAnalysisContext) {
      const textForAnalysis = rawText?.trim();
      if (!textForAnalysis) {
        return;
      }

      // Fetch recent channel messages for context
      let recentMessages: string[] = [];
      try {
        const history = await client.conversations.history({
          channel: event.channel,
          latest: event.ts,
          limit: 10,
          inclusive: false,
        });
        recentMessages = (history.messages ?? [])
          .reverse()
          .map((m) => m.text?.slice(0, 200) ?? "")
          .filter(Boolean);
      } catch {
        // Non-fatal — proceed without context
      }

      const sharedContext = loadPreAnalysisContext();
      const shouldRespond = await runPreAnalysis(textForAnalysis, rule.preAnalysisContext, sharedContext || undefined, recentMessages);
      logger.debug(
        `Pre-analysis: channel=${event.channel}, rule=${rule.id}, verdict=${shouldRespond ? "yes" : "no"}`
      );
      if (!shouldRespond) {
        return;
      }
    }

    // Extract message text, falling back for attachment-only messages
    const messageText = rawText?.trim() || "Respond to this message";

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
        additionalSystemPrompt: rule.extraContext,
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
