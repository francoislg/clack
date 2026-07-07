import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { getConfig, type Config } from "../../config.js";
import { logger } from "../../logger.js";
import { findMatchingRule, loadRules } from "../../autoRespond.js";
import {
  getEphemeralRuleForChannel,
  ratchetEphemeralRule,
  renewEphemeralRule,
  deleteEphemeralRuleForChannel,
  type EphemeralRule,
} from "../../ephemeralRules.js";
import {
  runPreAnalysis,
  runActiveRunPreAnalysis,
  runChannelContinuationPreAnalysis,
  type PreAnalysisMessage,
} from "../../claude/preAnalysis.js";
import { loadPreAnalysisContext } from "../../configurationFiles.js";
import {
  findSessionByThread,
  setAttentionLevel,
  isEngaged,
  type SettableAttentionLevel,
} from "../../sessions.js";
import type { PreAnalysisLevel } from "../../claude/preAnalysis.js";
import { resolveUsers } from "../userCache.js";
import { getChannelInfo } from "../channelCache.js";
import { resolveChannelLabel, resolveUserLabel, slackLink } from "../logContext.js";
import { extractAttachments } from "../fileExtractor.js";
import { buildImageOnlyPreAnalysisText } from "../imageFormatting.js";
import { processMessage } from "./core.js";
import { matchesInlineStopEmoji } from "../stopEmoji.js";
import { stopThread } from "../stopPipeline.js";
import { getBotIdentity } from "../botIdentity.js";
import { getForChannelMessage as getActiveRunForChannelMessage } from "../activeRuns.js";
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
  /** Pre-analysis verdict that led to this response — forwarded to processMessage so it
   *  lands on the session trigger (new session) and every assistant message (per-turn). */
  preAnalysis?: string;
  /** autoRespond rule that matched (top-level only). Missing on threadReply. */
  ruleName?: string;
  /** Initial attention level seeded onto the new session from the matched rule (top-level only). */
  attentionLevel?: SettableAttentionLevel;
  /** channelReply only: the ephemeral rule's anchor session, resumed by processMessage. */
  resumeSessionId?: string;
}

export interface AutoRespondDeps {
  findSession: typeof findSessionByThread;
  setAttentionLevel: typeof setAttentionLevel;
  preAnalysis: typeof runPreAnalysis;
  activeRunPreAnalysis: typeof runActiveRunPreAnalysis;
  loadSharedContext: typeof loadPreAnalysisContext;
  getActiveRun: typeof getActiveRunForChannelMessage;
  getEphemeralRule: typeof getEphemeralRuleForChannel;
  channelContinuationPreAnalysis: typeof runChannelContinuationPreAnalysis;
  ratchetEphemeralRule: typeof ratchetEphemeralRule;
  renewEphemeralRule: typeof renewEphemeralRule;
  deleteEphemeralRule: typeof deleteEphemeralRuleForChannel;
}

const defaultAutoRespondDeps: AutoRespondDeps = {
  findSession: findSessionByThread,
  setAttentionLevel,
  preAnalysis: runPreAnalysis,
  activeRunPreAnalysis: runActiveRunPreAnalysis,
  loadSharedContext: loadPreAnalysisContext,
  getActiveRun: getActiveRunForChannelMessage,
  getEphemeralRule: getEphemeralRuleForChannel,
  channelContinuationPreAnalysis: runChannelContinuationPreAnalysis,
  ratchetEphemeralRule,
  renewEphemeralRule,
  deleteEphemeralRule: deleteEphemeralRuleForChannel,
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
  rawFiles?: unknown[],
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
    if (!isEngaged(session)) {
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
      await deps.setAttentionLevel(session.sessionId, "off");
      return null;
    }

    const level = session.attentionLevel ?? "medium";

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

    // Pre-analysis: filter noise in thread replies. When text is empty but the
    // message carries image uploads, synthesize a textual placeholder so
    // pre-analysis can still classify based on thread history.
    let textForAnalysis = rawText?.trim();
    if (!textForAnalysis) {
      const { imageFiles } = extractAttachments(rawFiles);
      if (imageFiles?.length) {
        textForAnalysis = buildImageOnlyPreAnalysisText(imageFiles);
      } else {
        logger.debug(`Thread auto-respond: empty message, skipping${threadLink}`);
        return null;
      }
    }

    // "always" attention skips the pre-analysis gate entirely (both the standard and
    // active-run variants) and responds to every message in the thread.
    if (level === "always") {
      logger.info(
        `Thread auto-respond: always-on session ${session.sessionId} in ${channelLabel}${threadLink}`,
      );
      return {
        triggerType: "threadReply",
        userId: messageUser ?? "thread-reply",
        preAnalysis: "always",
      };
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

    // Past the "always"/disengaged guards, the rung is one of low/medium/high.
    const gateLevel: PreAnalysisLevel = level === "high" || level === "low" ? level : "medium";

    const sharedContext = deps.loadSharedContext();
    const baseThreadContext = enrichment.historyUnavailable
      ? `${THREAD_PRE_ANALYSIS_CONTEXT} Note: message history could not be retrieved.`
      : THREAD_PRE_ANALYSIS_CONTEXT;
    const threadPreAnalysisContext = session.creationContext
      ? `${baseThreadContext}\n\nWhy this conversation exists: ${session.creationContext}`
      : baseThreadContext;

    // Elapsed time since the bot's most recent in-thread message. A short gap is a strong
    // signal the incoming reply is aimed at the bot; the gate weighs it as a decaying lean.
    // Undefined when the thread carries no prior bot message (nothing to measure against).
    const lastBotTs = [...enrichment.history].reverse().find((m) => m.isBot)?.ts;
    const parsedBotTs = lastBotTs != null ? parseFloat(lastBotTs) : Number.NaN;
    const secondsSinceLastBotMessage = Number.isFinite(parsedBotTs)
      ? Math.max(0, parseFloat(messageTs) - parsedBotTs)
      : undefined;

    // If a Claude run is already in flight for this thread, switch to the active-run
    // pre-analysis variant: a different prompt that biases toward "append" (the user is
    // actively engaged) and only returns "append" or "skip" — there's no "stop" because
    // the live run owns the thread.
    const activeRun = deps.getActiveRun(channelId, threadTs, messageUser);
    if (activeRun && activeRun.status === "running") {
      const activeVerdict = await deps.activeRunPreAnalysis(
        enrichment.resolvedMessageText,
        enrichment.messageAuthorName,
        botName,
        threadPreAnalysisContext,
        sharedContext || undefined,
        enrichment.history,
        channelInfo?.name,
        threadLink,
        secondsSinceLastBotMessage,
      );
      logger.info(
        `Thread auto-respond (active run): ${channelLabel}, verdict=${activeVerdict}${threadLink}`,
      );
      if (activeVerdict === "skip") return null;
      return {
        triggerType: "threadReply",
        userId: messageUser ?? "thread-reply",
        preAnalysis: `active-run-${activeVerdict}`,
      };
    }

    const verdict = await deps.preAnalysis(
      enrichment.resolvedMessageText,
      enrichment.messageAuthorName,
      botName,
      threadPreAnalysisContext,
      sharedContext || undefined,
      enrichment.history,
      channelInfo?.name,
      threadLink,
      secondsSinceLastBotMessage,
      undefined,
      gateLevel,
    );
    logger.debug(
      `Thread pre-analysis: ${channelLabel}, verdict=${verdict}, level=${gateLevel}${threadLink}`,
    );
    if (verdict === "stop") {
      logger.info(
        `Thread auto-respond: disengaging session ${session.sessionId} in ${channelLabel}${threadLink}`,
      );
      await deps.setAttentionLevel(session.sessionId, "off");
      return null;
    }
    if (verdict !== "respond") return null;

    // A stop reaction can fire during pre-analysis (a multi-second Claude call) and
    // flip the attention level on disk. Re-read to catch a disengage in that window.
    const latest = await deps.findSession(channelId, threadTs);
    if (latest && !isEngaged(latest)) {
      logger.info(
        `Thread auto-respond: session ${latest.sessionId} was disengaged during pre-analysis in ${channelLabel}${threadLink}`,
      );
      return null;
    }

    return {
      triggerType: "threadReply",
      userId: messageUser ?? "thread-reply",
      preAnalysis: verdict,
    };
  }

  // Top-level: an ephemeral conversation window outranks standing rules. When one exists
  // for the channel, it owns this message entirely — whatever the verdict, standing rules
  // never get a shot at the same message.
  const ephemeralRule = await deps.getEphemeralRule(channelId);
  if (ephemeralRule) {
    return resolveEphemeralConversation(
      ephemeralRule,
      channelId,
      messageTs,
      messageUser,
      rawText,
      config,
      client,
      botUserId,
      botId,
      channelInfo?.name,
      channelLabel,
      deps,
      rawFiles,
    );
  }

  // Standing rules: rule matching + pre-analysis
  if (!config.autoRespond?.enabled) return null;

  const rules = await loadRules();
  if (rules.length === 0) return null;

  const rule = await findMatchingRule(channelId, messageUser, rawText);
  if (!rule) return null;

  // The rule seeds the new session's level. For the channel-engagement gate itself, cap
  // "always" to "high" so the classifier still runs — an unfiltered "always" rule must not
  // firehose the whole channel.
  const ruleLevel = rule.attentionLevel ?? "medium";
  const gateLevel: PreAnalysisLevel = ruleLevel === "always" ? "high" : ruleLevel;

  let topLevelVerdict: string | undefined;
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
    topLevelVerdict = await deps.preAnalysis(
      enrichment.resolvedMessageText,
      enrichment.messageAuthorName,
      botName,
      rulePreAnalysisContext,
      sharedContext || undefined,
      enrichment.history,
      channelInfo?.name,
      messageLink,
      undefined,
      undefined,
      gateLevel,
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
    ...(topLevelVerdict !== undefined ? { preAnalysis: topLevelVerdict } : {}),
    ruleName: rule.id,
    ...(rule.attentionLevel ? { attentionLevel: rule.attentionLevel } : {}),
  };
}

/** Prompt additions for a channelReply turn: the seed's creation context, the pull-based
 *  ledger hint, and placement guidance (quick beats top-level, depth moves to a thread). */
function buildChannelReplyPrompt(rule: EphemeralRule): string {
  const parts: string[] = [
    "You are continuing a conversation you started with a top-level post in this channel. " +
      "The user replied in the channel (not in a thread).",
    "PLACEMENT: for a quick conversational beat, reply top-level in the channel (`post_top_level: true`) to keep the conversation flowing. " +
      "For anything substantive (detailed answers, code, multi-step help), reply WITHOUT `post_top_level` so your answer threads under the user's message.",
  ];
  if (rule.creationContext) {
    parts.push(`CREATION CONTEXT (why you posted; hidden from users): ${rule.creationContext}`);
  }
  if (rule.sessionIds.length > 1) {
    parts.push(
      `This conversation has ${rule.sessionIds.length} linked sessions (side-threads it spawned). ` +
        "If you need what was said in them, retrieve them with `find_sessions` — do not guess.",
    );
  }
  return parts.join("\n\n");
}

/**
 * Lifecycle for a top-level message in a channel with an ephemeral conversation window.
 * The judge ALWAYS runs while the rule exists — expiry never short-circuits it; a past-expiry
 * rule is dormant, and this message is the event that decides its fate:
 *   respond → continue the anchor session, renew the window (even when dormant — revival)
 *   skip    → within the window: ratchet one rung; dormant: delete
 *   stop    → delete
 *   null    → classifier failure: no response, rule untouched
 */
async function resolveEphemeralConversation(
  rule: EphemeralRule,
  channelId: string,
  messageTs: string,
  messageUser: string | undefined,
  rawText: string | undefined,
  config: Config,
  client: WebClient,
  botUserId: string,
  botId: string | undefined,
  channelName: string | undefined,
  channelLabel: string,
  deps: AutoRespondDeps,
  rawFiles?: unknown[],
): Promise<AutoRespondContext | null> {
  let textForAnalysis = rawText?.trim();
  if (!textForAnalysis) {
    const { imageFiles } = extractAttachments(rawFiles);
    if (imageFiles?.length) {
      textForAnalysis = buildImageOnlyPreAnalysisText(imageFiles);
    } else {
      return null;
    }
  }

  const botName = config.slackApp?.name ?? "Clack";
  const messageLink = await slackLink(client, channelId, messageTs);
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
    "Channel-continuation pre-analysis: failed to enrich message context",
  );

  const lastBotTs = [...enrichment.history].reverse().find((m) => m.isBot)?.ts;
  const parsedBotTs = lastBotTs != null ? parseFloat(lastBotTs) : Number.NaN;
  const secondsSinceLastBotMessage = Number.isFinite(parsedBotTs)
    ? Math.max(0, parseFloat(messageTs) - parsedBotTs)
    : undefined;

  const verdict = await deps.channelContinuationPreAnalysis(
    enrichment.resolvedMessageText,
    enrichment.messageAuthorName,
    botName,
    rule.anchorText,
    rule.attentionLevel,
    deps.loadSharedContext() || undefined,
    enrichment.history,
    channelName,
    messageLink,
    secondsSinceLastBotMessage,
    rule.creationContext,
  );

  const dormant = Date.now() > rule.expiresAt;
  logger.info(
    `Channel conversation ${rule.id} in ${channelLabel}: verdict=${verdict ?? "error"}, level=${rule.attentionLevel}, dormant=${dormant}${messageLink}`,
  );

  if (verdict === null) return null;

  // Lifecycle mutations are best-effort: a failed disk write must never crash the event
  // handler (skip/stop) or block a respond verdict from answering. The next message's
  // verdict re-runs the same transition, so a lost mutation self-heals.
  const mutate = async (
    label: string,
    op: () => Promise<EphemeralRule | boolean | null>,
  ): Promise<void> => {
    try {
      await op();
    } catch (err) {
      logger.warn(`Channel conversation ${rule.id}: ${label} failed (continuing):`, err);
    }
  };

  if (verdict === "stop") {
    await mutate("close on stop", () => deps.deleteEphemeralRule(channelId));
    return null;
  }

  if (verdict === "skip") {
    if (dormant) {
      await mutate("dormant close", () => deps.deleteEphemeralRule(channelId));
    } else {
      await mutate("ratchet", () => deps.ratchetEphemeralRule(rule.id));
    }
    return null;
  }

  await mutate("renew", () => deps.renewEphemeralRule(rule.id));
  return {
    triggerType: "channelReply",
    userId: messageUser ?? "channel-reply",
    preAnalysis: `channel-${verdict}`,
    resumeSessionId: rule.sessionIds[0],
    additionalSystemPrompt: buildChannelReplyPrompt(rule),
  };
}

export function registerAutoRespondHandler(app: App): void {
  app.event("message", async ({ event, client }) => {
    // Skip non-message subtypes (edits, deletes, joins, etc.) — but allow bot_message through
    if ("subtype" in event && event.subtype !== undefined && event.subtype !== "bot_message") {
      return;
    }

    const { botUserId, botId } = await getBotIdentity(client);
    if (!botUserId) return;

    const messageUser = "user" in event && typeof event.user === "string" ? event.user : undefined;
    if (messageUser === botUserId) return;

    const messageBotId =
      "bot_id" in event && typeof event.bot_id === "string" ? event.bot_id : undefined;
    if (messageBotId && messageBotId === botId) return;

    // Skip @mentions — handled by mention handler
    const rawText = "text" in event && typeof event.text === "string" ? event.text : undefined;
    if (rawText && botUserId && rawText.includes(`<@${botUserId}>`)) return;

    const config = getConfig();
    const threadTs =
      "thread_ts" in event && typeof event.thread_ts === "string" ? event.thread_ts : undefined;

    // Inline stop-emoji short-circuit: dispatched before pre-analysis and rule matching.
    if (messageUser && matchesInlineStopEmoji(rawText, config.reactions?.stop)) {
      const targetThread = threadTs || event.ts;
      logger.info(
        `Inline stop emoji in thread reply from ${messageUser} in ${event.channel} (thread ${targetThread})`,
      );
      // A top-level stop also closes the channel's conversation window, if one exists.
      if (!threadTs) {
        await deleteEphemeralRuleForChannel(event.channel);
      }
      await stopThread(event.channel, targetThread, messageUser, "stopped via inline emoji");
      return;
    }
    const rawFiles = "files" in event && Array.isArray(event.files) ? event.files : undefined;

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
      undefined,
      rawFiles,
    );
    if (!context) return;

    // Concurrency: a thread-level lock is no longer needed here. `processMessage` itself
    // consults the active-runs registry and routes a follow-up onto the live `ClaudeRunHandle`
    // via `sendUpdate` if one exists. The previous in-process Set only protected against
    // overlapping pre-analysis cycles within one node — duplicate work, not correctness —
    // and the registry path replaces that with first-result-wins queueing on the run.
    await respond(event, client, context, threadTs);
  });
}

interface RespondEvent {
  channel: string;
  ts: string;
  text?: string;
  files?: unknown[];
}

async function respond(
  event: RespondEvent,
  client: App["client"],
  context: AutoRespondContext,
  threadTs: string | undefined,
): Promise<void> {
  const rawText = typeof event.text === "string" ? event.text : undefined;
  const rawFiles = Array.isArray(event.files) ? event.files : undefined;
  const attachments = extractAttachments(rawFiles);
  const trimmedText = rawText?.trim();

  let messageText: string;
  if (trimmedText) {
    messageText = trimmedText;
  } else if (attachments.imageFiles?.length) {
    messageText = "Answer based on the attached image(s).";
  } else {
    messageText = "Respond to this message";
  }

  const channelLabel = await resolveChannelLabel(client, event.channel);
  const userLabel = await resolveUserLabel(client, context.userId);
  const link = await slackLink(client, event.channel, threadTs ?? event.ts);
  logger.info(
    `Auto-respond triggered: ${userLabel} in ${channelLabel} (${context.triggerType})${link}`,
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
      preAnalysis: context.preAnalysis,
      autoRespondRuleName: context.ruleName,
      attentionLevel: context.attentionLevel,
      resumeSessionId: context.resumeSessionId,
      ...attachments,
    });
  } catch (error) {
    logger.error(
      `Auto-respond failed: ${channelLabel}, trigger=${context.triggerType}${link}`,
      error,
    );
  }
}
