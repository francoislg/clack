import type { App } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import {
  findSessionByThread,
  createSession,
  getSession,
  updateSession,
  updateThreadContext,
} from "../../sessions.js";
import { getConfig, type Config } from "../../config.js";
import { logger } from "../../logger.js";
import { setSessionInfo } from "../state.js";
import { fetchThreadContext } from "../messagesApi.js";
import { transformUserMentions } from "../userCache.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { getReactionDelivery } from "../../userPreferences.js";
import { registerInFlightRequest, deregisterInFlightRequest } from "../inFlightRequests.js";
import { storeDmCoordinates } from "../dmResponse.js";
import { executeAndDeliver } from "./handlerResponse.js";
import type { TriggerType } from "../../changes/types.js";

export interface ProcessMessageParams {
  client: App["client"];
  userId: string;
  channelId: string;
  messageTs: string;
  messageText: string;
  threadTs?: string;
  triggerType: TriggerType;
  /** When true, hints Claude to propose a change with auto-execute */
  workMode?: boolean;
  /** Channel the user is viewing in the assistant panel */
  assistantChannelId?: string;
}

interface ProcessingContext {
  client: App["client"];
  config: Config;
  userId: string;
  channelId: string;
  messageTs: string;
  messageText: string;
  threadTs?: string;
  effectiveThreadTs: string;
  triggerType: TriggerType;
  /** DM delivery mode for reactions */
  isDm: boolean;
  /** DM channel ID (set during DM flow) */
  dmChannel?: string;
  /** DM thread ts (set during DM flow) */
  dmThreadTs?: string;
  /** When true, hints Claude to propose a change with auto-execute */
  workMode: boolean;
}

// ============================================================
// SESSION SETUP
// ============================================================

async function setupSession(ctx: ProcessingContext): Promise<SessionContext> {
  const { client, config, userId, channelId, messageTs, messageText, threadTs, effectiveThreadTs } = ctx;

  const authResult = await client.auth.test();
  const botUserId = authResult.user_id || "";

  const threadContext = threadTs
    ? await fetchThreadContext(client, channelId, threadTs, botUserId, {
        fetchUserNames: config.slack.fetchAndStoreUsername,
      })
    : [];

  const processedMessageText = config.slack.fetchAndStoreUsername
    ? await transformUserMentions(client, messageText)
    : messageText;

  let session = threadTs
    ? await findSessionByThread(channelId, threadTs)
    : null;

  if (!session) {
    session = await createSession(
      channelId,
      messageTs,
      effectiveThreadTs,
      userId,
      processedMessageText,
      threadContext
    );
    logger.debug(`Created session ${session.sessionId}`);
  } else {
    await updateThreadContext(session.sessionId, threadContext);
    await updateSession(session.sessionId, { originalQuestion: processedMessageText });
    session = (await getSession(session.sessionId))!;
  }

  // Persist trigger metadata so button handlers can restore it from disk
  await updateSession(session.sessionId, {
    triggerType: ctx.triggerType,
  });

  setSessionInfo(session.sessionId, {
    channelId,
    threadTs: effectiveThreadTs,
    userId,
    triggerType: ctx.triggerType,
  });

  return session;
}

// ============================================================
// DM SETUP (reaction DM-first mode)
// ============================================================

/**
 * Open a DM conversation and return the channel ID, or null on failure.
 */
async function openDmChannel(client: App["client"], userId: string): Promise<string | null> {
  try {
    const result = await client.conversations.open({ users: userId });
    return result.channel?.id ?? null;
  } catch (error) {
    logger.error("Failed to open DM channel:", error);
    return null;
  }
}

/**
 * Set up DM delivery for reaction triggers: open DM, post parent message, store coordinates.
 * Returns true if DM setup succeeded, false to fall back to thread mode.
 */
async function setupDmDelivery(ctx: ProcessingContext, session: SessionContext): Promise<boolean> {
  const dmChannel = await openDmChannel(ctx.client, ctx.userId);
  if (!dmChannel) {
    logger.warn("DM delivery failed, falling back to thread mode");
    return false;
  }

  ctx.dmChannel = dmChannel;

  // Get permalink for the original message
  let permalink: string | undefined;
  try {
    const result = await ctx.client.chat.getPermalink({
      channel: ctx.channelId,
      message_ts: ctx.messageTs,
    });
    permalink = result.permalink;
  } catch {
    // Non-critical — fall back to channel mention only
  }

  // Post a thread parent in the DM so subsequent replies are threaded
  const linkText = permalink
    ? `<${permalink}|this message> in <#${ctx.channelId}>`
    : `a message in <#${ctx.channelId}>`;
  const parent = await ctx.client.chat.postMessage({
    channel: dmChannel,
    text: `_Looking into ${linkText}..._`,
  });
  if (parent.ts) {
    ctx.dmThreadTs = parent.ts;
  }

  // Store DM coordinates in the session
  await storeDmCoordinates(
    session.sessionId,
    dmChannel,
    ctx.dmThreadTs || ctx.effectiveThreadTs,
    ctx.channelId,
    ctx.effectiveThreadTs,
  );

  return true;
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export async function processMessage(params: ProcessMessageParams): Promise<void> {
  const {
    client,
    userId,
    channelId,
    messageTs,
    messageText,
    threadTs,
    triggerType,
    workMode = false,
  } = params;

  const config = getConfig();

  // Resolve DM delivery for reaction triggers based on user preference
  let isDm = false;
  if (triggerType === "reactions") {
    const delivery = await getReactionDelivery(userId);
    isDm = delivery === "dm";
  }

  const ctx: ProcessingContext = {
    client,
    config,
    userId,
    channelId,
    messageTs,
    messageText,
    threadTs,
    effectiveThreadTs: threadTs || messageTs,
    triggerType,
    isDm,
    workMode,
  };

  const assistantSuffix = params.assistantChannelId ? ` [assistant panel, viewing ${params.assistantChannelId}]` : "";
  logger.debug(`Processing message from ${userId} in ${channelId} (trigger: ${triggerType}, dm: ${isDm})${assistantSuffix}`);

  // 1. Set up or retrieve session
  let session = await setupSession(ctx);

  // 2. DM setup for reaction triggers (before executeAndDeliver sees sessionInfo)
  if (isDm) {
    const dmOk = await setupDmDelivery(ctx, session);
    if (!dmOk) {
      isDm = false;
      ctx.isDm = false;
    }
  }

  // 3. Store assistant channel context on session before Claude runs
  if (params.assistantChannelId) {
    const currentSession = await getSession(session.sessionId);
    const updates: Record<string, unknown> = {
      assistantCurrentChannelId: params.assistantChannelId,
    };
    if (!currentSession?.assistantOriginChannelId) {
      updates.assistantOriginChannelId = params.assistantChannelId;
    }
    const updated = await updateSession(session.sessionId, updates);
    if (updated) {
      session = updated;
    }
  }

  // 4. Update sessionInfo with DM coordinates (if set)
  const sessionInfo = {
    channelId,
    threadTs: ctx.effectiveThreadTs,
    userId,
    triggerType,
    ...(ctx.dmChannel && { dmChannel: ctx.dmChannel }),
    ...(ctx.dmThreadTs && { dmThreadTs: ctx.dmThreadTs }),
  };
  setSessionInfo(session.sessionId, sessionInfo);

  // 5. Build Claude options
  const claudeOptions = await getClaudeOptions(userId, triggerType);

  // 6. In-flight request registration for cancellation support
  const abortController = new AbortController();
  const canCancel = triggerType === "mentions" || triggerType === "directMessages";
  if (canCancel) {
    registerInFlightRequest(channelId, messageTs, {
      abortController,
      sessionId: session.sessionId,
      triggerType,
    });
  }

  try {
    // 7. Delegate to executeAndDeliver — handles streaming, delivery, errors, auto-execute
    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: { ...claudeOptions, workMode },
      abortController,
    });
  } finally {
    if (canCancel) {
      deregisterInFlightRequest(channelId, messageTs);
    }
  }
}
