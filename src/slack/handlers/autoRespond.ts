import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { getConfig, type Config } from "../../config.js";
import { logger } from "../../logger.js";
import { findMatchingRule, loadRules } from "../../autoRespond.js";
import { runPreAnalysis } from "../../claude/preAnalysis.js";
import { loadPreAnalysisContext } from "../../configurationFiles.js";
import { findSessionByThread } from "../../sessions.js";
import { extractAttachments } from "../fileExtractor.js";
import { processMessage } from "./core.js";
import type { TriggerType } from "../../changes/types.js";

const AUTO_RESPOND_USER_ID = "auto-respond";

interface AutoRespondContext {
  triggerType: TriggerType;
  userId: string;
  additionalSystemPrompt?: string;
}

/**
 * Determine whether and how the bot should auto-respond to this message.
 * Thread replies gate on session existence; top-level messages gate on rule matching.
 */
async function resolveAutoRespondContext(
  channelId: string,
  messageTs: string,
  messageUser: string | undefined,
  messageBotId: string | undefined,
  rawText: string | undefined,
  threadTs: string | undefined,
  config: Config,
  client: WebClient,
): Promise<AutoRespondContext | null> {
  if (threadTs) {
    if (config.threadAutoRespond === false) {
      logger.info(`Thread auto-respond disabled by config`);
      return null;
    }
    if (messageBotId) {
      logger.info(`Thread auto-respond: skipping bot message in ${channelId}`);
      return null;
    }
    const session = await findSessionByThread(channelId, threadTs);
    if (!session) {
      logger.info(`Thread auto-respond: no session for thread ${channelId}:${threadTs}`);
      return null;
    }
    logger.info(
      `Thread auto-respond: found session ${session.sessionId} for thread ${channelId}:${threadTs}`,
    );

    if (session.activeChange?.status === "pr_created") {
      const text = rawText?.trim() ?? "";
      if (
        /^(merge|ship it|lgtm|looks good|close|abandon|cancel|review|check comments|address feedback|approve)$/i.test(
          text,
        )
      ) {
        return null;
      }
    }

    return { triggerType: "threadReply", userId: messageUser ?? "thread-reply" };
  }

  // Top-level: rule matching + pre-analysis
  if (!config.autoRespond?.enabled) return null;

  const rules = await loadRules();
  if (rules.length === 0) return null;

  const rule = await findMatchingRule(channelId, messageUser, rawText);
  if (!rule) return null;

  if (rule.preAnalysisContext) {
    const textForAnalysis = rawText?.trim();
    if (!textForAnalysis) return null;

    let recentMessages: string[] = [];
    try {
      const history = await client.conversations.history({
        channel: channelId,
        latest: messageTs,
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
    const shouldRespond = await runPreAnalysis(
      textForAnalysis,
      rule.preAnalysisContext,
      sharedContext || undefined,
      recentMessages,
    );
    logger.debug(
      `Pre-analysis: channel=${channelId}, rule=${rule.id}, verdict=${shouldRespond ? "yes" : "no"}`,
    );
    if (!shouldRespond) return null;
  }

  return {
    triggerType: "autoRespond",
    userId: messageUser ?? AUTO_RESPOND_USER_ID,
    additionalSystemPrompt: rule.extraContext,
  };
}

export function registerAutoRespondHandler(app: App): void {
  let botUserId: string | undefined;
  let botId: string | undefined;

  const processingThreads = new Set<string>();

  app.event("message", async ({ event, client }) => {
    // Skip non-message subtypes (edits, deletes, joins, etc.) — but allow bot_message through
    if ("subtype" in event && event.subtype !== undefined && event.subtype !== "bot_message") {
      return;
    }

    // Resolve bot identity (cached)
    if (!botUserId) {
      const authResult = await client.auth.test();
      botUserId = authResult.user_id;
      botId = authResult.bot_id;
    }

    const messageUser = "user" in event ? (event.user as string | undefined) : undefined;
    if (messageUser === botUserId) return;

    const messageBotId =
      "bot_id" in event ? (event as unknown as { bot_id: string }).bot_id : undefined;
    if (messageBotId && messageBotId === botId) return;

    // Skip @mentions — handled by mention handler
    const rawText = "text" in event ? (event.text as string | undefined) : undefined;
    if (rawText && botUserId && rawText.includes(`<@${botUserId}>`)) return;

    const config = getConfig();
    const threadTs = "thread_ts" in event ? (event.thread_ts as string | undefined) : undefined;

    const context = await resolveAutoRespondContext(
      event.channel,
      event.ts,
      messageUser,
      messageBotId,
      rawText,
      threadTs,
      config,
      client,
    );
    if (!context) return;

    // Thread processing lock
    if (threadTs) {
      const threadKey = `${event.channel}:${threadTs}`;
      if (processingThreads.has(threadKey)) return;
      processingThreads.add(threadKey);
      try {
        await respond(event, client, context, threadTs);
      } finally {
        processingThreads.delete(threadKey);
      }
      return;
    }

    await respond(event, client, context, threadTs);
  });
}

async function respond(
  event: { channel: string; ts: string },
  client: App["client"],
  context: AutoRespondContext,
  threadTs: string | undefined,
): Promise<void> {
  const rawText = "text" in event ? (event as unknown as { text?: string }).text : undefined;
  const messageText = rawText?.trim() || "Respond to this message";

  logger.info(
    `Auto-respond triggered: channel=${event.channel}, trigger=${context.triggerType}, author=${context.userId}`,
  );

  const attachments = extractAttachments(
    "files" in event ? (event as unknown as { files?: unknown[] }).files : undefined,
  );

  try {
    await processMessage({
      client,
      userId: context.userId,
      channelId: event.channel,
      messageTs: event.ts,
      messageText,
      threadTs,
      triggerType: context.triggerType,
      additionalSystemPrompt: context.additionalSystemPrompt,
      ...attachments,
    });
  } catch (error) {
    logger.error(
      `Auto-respond failed: channel=${event.channel}, trigger=${context.triggerType}`,
      error,
    );
  }
}
