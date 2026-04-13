import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { getConfig, type Config } from "../../config.js";
import { logger } from "../../logger.js";
import { findMatchingRule, loadRules } from "../../autoRespond.js";
import { runPreAnalysis, type PreAnalysisMessage } from "../../claude/preAnalysis.js";
import { loadPreAnalysisContext } from "../../configurationFiles.js";
import { findSessionByThread, setAutoResponseActive } from "../../sessions.js";
import { resolveUsers } from "../userCache.js";
import { getChannelInfo } from "../channelCache.js";
import { resolveChannelLabel, resolveUserLabel, slackLink } from "../logContext.js";
import { extractAttachments } from "../fileExtractor.js";
import { processMessage } from "./core.js";
import type { TriggerType } from "../../changes/types.js";

const AUTO_RESPOND_USER_ID = "auto-respond";

const MENTION_PATTERN = /<@([UW][A-Z0-9]+)>/g;

const THREAD_PRE_ANALYSIS_CONTEXT =
  "This is a thread where the bot previously answered a question. Respond only to genuine follow-up questions or requests for clarification. Skip acknowledgments (thanks, got it, cool), noise (+1, emoji, lol), and conversation between other people that doesn't require the bot's input. STOP monitoring if the conversation has clearly moved to unrelated topics, the user indicated they're done, or several messages passed with no follow-up questions — but only when confident the thread is truly finished.";

interface PreAnalysisEnrichment {
  history: PreAnalysisMessage[];
  resolvedMessageText: string;
  messageAuthorName: string;
  historyUnavailable?: boolean;
}

/**
 * Resolve user mentions and build enriched message history for pre-analysis.
 * Shared between top-level and thread reply pre-analysis paths.
 */
async function enrichForPreAnalysis(
  client: WebClient,
  rawMessages: Array<{
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
  }>,
  currentText: string,
  messageUser: string | undefined,
  botUserId: string,
  botId: string | undefined,
  botName: string,
): Promise<PreAnalysisEnrichment> {
  const allUserIds = new Set<string>();
  if (messageUser) allUserIds.add(messageUser);
  for (const m of rawMessages) {
    if (m.user) allUserIds.add(m.user);
    if (m.bot_id) allUserIds.add(m.bot_id);
    for (const match of (m.text ?? "").matchAll(MENTION_PATTERN)) {
      allUserIds.add(match[1]);
    }
  }
  for (const match of currentText.matchAll(MENTION_PATTERN)) {
    allUserIds.add(match[1]);
  }

  const userInfoMap = await resolveUsers(client, [...allUserIds]);

  const resolveMention = (_: string, id: string): string => {
    const u = userInfoMap.get(id);
    return `@${u?.displayName ?? u?.username ?? id}`;
  };

  const history: PreAnalysisMessage[] = rawMessages
    .map((m) => {
      const userId = m.user ?? m.bot_id;
      const isBotMessage = m.user === botUserId || (m.bot_id != null && m.bot_id === botId);
      const info = userId ? userInfoMap.get(userId) : undefined;
      const author = isBotMessage
        ? `${botName} (bot)`
        : (info?.displayName ?? info?.username ?? "Unknown");
      let text = m.text?.slice(0, 300) ?? "";
      text = text.replace(MENTION_PATTERN, resolveMention);
      return { author, text, isBot: isBotMessage, ts: m.ts };
    })
    .filter((m) => m.text);

  const resolvedMessageText = currentText.replace(MENTION_PATTERN, resolveMention);

  let messageAuthorName = "Unknown";
  if (messageUser) {
    const authorInfo = userInfoMap.get(messageUser);
    messageAuthorName = authorInfo?.displayName ?? authorInfo?.username ?? "Unknown";
  }

  return { history, resolvedMessageText, messageAuthorName };
}

type RawMessage = {
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
};

/**
 * Fetch messages, enrich them for pre-analysis, and return the result.
 * Falls back to default enrichment (no history) if fetching fails.
 */
async function fetchEnrichedContext(
  client: WebClient,
  fetchMessages: () => Promise<RawMessage[]>,
  textForAnalysis: string,
  messageUser: string | undefined,
  botUserId: string,
  botId: string | undefined,
  botName: string,
  warnLabel: string,
): Promise<PreAnalysisEnrichment> {
  const defaultEnrichment: PreAnalysisEnrichment = {
    history: [],
    resolvedMessageText: textForAnalysis,
    messageAuthorName: "Unknown",
  };
  try {
    const messages = await fetchMessages();
    return await enrichForPreAnalysis(
      client,
      messages,
      textForAnalysis,
      messageUser,
      botUserId,
      botId,
      botName,
    );
  } catch (error) {
    logger.warn(warnLabel, error);
    return { ...defaultEnrichment, historyUnavailable: true };
  }
}

interface AutoRespondContext {
  triggerType: TriggerType;
  userId: string;
  additionalSystemPrompt?: string;
}

export interface AutoRespondDeps {
  findSession: typeof findSessionByThread;
  setActive: typeof setAutoResponseActive;
  preAnalysis: typeof runPreAnalysis;
  loadSharedContext: typeof loadPreAnalysisContext;
}

const defaultAutoRespondDeps: AutoRespondDeps = {
  findSession: findSessionByThread,
  setActive: setAutoResponseActive,
  preAnalysis: runPreAnalysis,
  loadSharedContext: loadPreAnalysisContext,
};

/**
 * Determine whether and how the bot should auto-respond to this message.
 * Thread replies gate on session existence; top-level messages gate on rule matching.
 */
export async function resolveAutoRespondContext(
  channelId: string,
  messageTs: string,
  messageUser: string | undefined,
  messageBotId: string | undefined,
  rawText: string | undefined,
  threadTs: string | undefined,
  config: Config,
  client: WebClient,
  botUserId: string,
  botId: string | undefined,
  deps: AutoRespondDeps = defaultAutoRespondDeps,
): Promise<AutoRespondContext | null> {
  const [channelInfo, channelLabel, userLabel] = await Promise.all([
    getChannelInfo(client, channelId),
    resolveChannelLabel(client, channelId),
    messageUser ? resolveUserLabel(client, messageUser) : Promise.resolve("unknown"),
  ]);

  if (threadTs) {
    const threadLink = await slackLink(client, channelId, threadTs);
    if (config.threadAutoRespond === false) {
      logger.info(`Thread auto-respond disabled by config`);
      return null;
    }
    if (messageBotId) {
      logger.debug(`Thread auto-respond: skipping bot message in ${channelLabel}${threadLink}`);
      return null;
    }
    const session = await deps.findSession(channelId, threadTs);
    if (!session) {
      logger.debug(
        `Thread auto-respond: no session for ${userLabel} in ${channelLabel}${threadLink}`,
      );
      return null;
    }
    // Skip disengaged threads without running pre-analysis
    if (session.autoResponseActive === false) {
      logger.debug(
        `Thread auto-respond: disengaged session ${session.sessionId} in ${channelLabel}${threadLink}`,
      );
      return null;
    }

    // Disengage if the message is older than the configured age cutoff
    const maxAgeMinutes = config.threadAutoRespondMaxAgeMinutes ?? 60;
    const messageAgeMinutes = (Date.now() / 1000 - parseFloat(messageTs)) / 60;
    if (messageAgeMinutes > maxAgeMinutes) {
      logger.info(
        `Thread auto-respond: disengaging session ${session.sessionId} — message is ${Math.round(messageAgeMinutes)}m old (max ${maxAgeMinutes}m) in ${channelLabel}${threadLink}`,
      );
      await deps.setActive(session.sessionId, false);
      return null;
    }

    logger.info(
      `Thread auto-respond: found session ${session.sessionId} for ${userLabel} in ${channelLabel}${threadLink}`,
    );

    // Skip workflow command messages — they're handled by dedicated change handlers
    if (session.activeChange?.status === "pr_created") {
      const text = rawText?.trim() ?? "";
      if (
        /^(merge|ship it|lgtm|looks good|close|abandon|cancel|review|check comments|address feedback|approve)$/i.test(
          text,
        )
      ) {
        logger.debug(
          `Thread auto-respond: skipping workflow command in ${channelLabel}${threadLink}`,
        );
        return null;
      }
    }

    // Pre-analysis: filter noise in thread replies
    const textForAnalysis = rawText?.trim();
    if (!textForAnalysis) {
      logger.debug(`Thread auto-respond: empty message, skipping${threadLink}`);
      return null;
    }

    const botName = config.slackApp?.name ?? "Clack";
    const enrichment = await fetchEnrichedContext(
      client,
      async () => {
        const replies = await client.conversations.replies({
          channel: channelId,
          ts: threadTs,
          latest: messageTs,
          inclusive: false,
          limit: 15,
        });
        return (replies.messages ?? []).filter((m) => m.ts !== threadTs).slice(-10);
      },
      textForAnalysis,
      messageUser,
      botUserId,
      botId,
      botName,
      "Thread pre-analysis: failed to fetch thread context",
    );

    const sharedContext = deps.loadSharedContext();
    const threadPreAnalysisContext = enrichment.historyUnavailable
      ? `${THREAD_PRE_ANALYSIS_CONTEXT} Note: message history could not be retrieved.`
      : THREAD_PRE_ANALYSIS_CONTEXT;
    const verdict = await deps.preAnalysis(
      enrichment.resolvedMessageText,
      enrichment.messageAuthorName,
      botName,
      threadPreAnalysisContext,
      sharedContext || undefined,
      enrichment.history,
      channelInfo?.name,
      threadLink,
    );
    logger.debug(`Thread pre-analysis: ${channelLabel}, verdict=${verdict}${threadLink}`);
    if (verdict === "stop") {
      logger.info(
        `Thread auto-respond: disengaging session ${session.sessionId} in ${channelLabel}${threadLink}`,
      );
      await deps.setActive(session.sessionId, false);
      return null;
    }
    if (verdict !== "respond") return null;

    return {
      triggerType: "threadReply",
      userId: messageUser ?? "thread-reply",
    };
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

    const botName = config.slackApp?.name ?? "Clack";
    const enrichment = await fetchEnrichedContext(
      client,
      async () => {
        const history = await client.conversations.history({
          channel: channelId,
          latest: messageTs,
          limit: 10,
          inclusive: false,
        });
        return (history.messages ?? []).reverse();
      },
      textForAnalysis,
      messageUser,
      botUserId,
      botId,
      botName,
      "Pre-analysis: failed to enrich message context",
    );

    const sharedContext = deps.loadSharedContext();
    const rulePreAnalysisContext = enrichment.historyUnavailable
      ? `${rule.preAnalysisContext} Note: message history could not be retrieved.`
      : rule.preAnalysisContext;
    const messageLink = await slackLink(client, channelId, messageTs);
    const topLevelVerdict = await deps.preAnalysis(
      enrichment.resolvedMessageText,
      enrichment.messageAuthorName,
      botName,
      rulePreAnalysisContext,
      sharedContext || undefined,
      enrichment.history,
      channelInfo?.name,
      messageLink,
    );
    logger.debug(
      `Pre-analysis: ${channelLabel}, rule=${rule.id}, verdict=${topLevelVerdict}${messageLink}`,
    );
    // Top-level messages have no session to disengage, so treat "stop" as "skip"
    if (topLevelVerdict !== "respond") return null;
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
    if (!botUserId) return;

    const messageUser = "user" in event && typeof event.user === "string" ? event.user : undefined;
    if (messageUser === botUserId) return;

    const messageBotId =
      "bot_id" in event ? (event as unknown as { bot_id: string }).bot_id : undefined;
    if (messageBotId && messageBotId === botId) return;

    // Skip @mentions — handled by mention handler
    const rawText = "text" in event && typeof event.text === "string" ? event.text : undefined;
    if (rawText && botUserId && rawText.includes(`<@${botUserId}>`)) return;

    const config = getConfig();
    const threadTs =
      "thread_ts" in event && typeof event.thread_ts === "string" ? event.thread_ts : undefined;

    const context = await resolveAutoRespondContext(
      event.channel,
      event.ts,
      messageUser,
      messageBotId,
      rawText,
      threadTs,
      config,
      client,
      botUserId,
      botId,
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

  const channelLabel = await resolveChannelLabel(client, event.channel);
  const userLabel = await resolveUserLabel(client, context.userId);
  const link = await slackLink(client, event.channel, threadTs ?? event.ts);
  logger.info(
    `Auto-respond triggered: ${userLabel} in ${channelLabel} (${context.triggerType})${link}`,
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
      `Auto-respond failed: ${channelLabel}, trigger=${context.triggerType}${link}`,
      error,
    );
  }
}
