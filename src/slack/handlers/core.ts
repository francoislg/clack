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
import { activeSessions } from "../activeSessions.js";
import { fetchThreadContext } from "../messagesApi.js";
import { transformUserMentions, getUserInfo } from "../userCache.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { getReactionDelivery } from "../../userPreferences.js";
import { registerInFlightRequest, deregisterInFlightRequest } from "../inFlightRequests.js";
import { storeDmCoordinates } from "../dmResponse.js";
import { executeAndDeliver } from "./handlerResponse.js";
import type { TriggerType } from "../../changes/types.js";
import type { SlackImageFile, SlackFile } from "../slackFileBase.js";

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
  /** Image files from the triggering message */
  imageFiles?: SlackImageFile[];
  /** Non-image file attachments from the triggering message */
  files?: SlackFile[];
  /** Extra context from the auto-respond rule */
  additionalSystemPrompt?: string;
}

interface ProcessingContext {
  readonly client: App["client"];
  readonly config: Config;
  readonly userId: string;
  readonly channelId: string;
  readonly messageTs: string;
  readonly messageText: string;
  readonly threadTs?: string;
  readonly effectiveThreadTs: string;
  readonly triggerType: TriggerType;
  /** When true, hints Claude to propose a change with auto-execute */
  readonly workMode: boolean;
  readonly additionalSystemPrompt?: string;
}

interface DmCoordinates {
  dmChannel: string;
  dmThreadTs?: string;
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

  // Resolve user info for session attribution
  const userInfo = await getUserInfo(client, userId);

  if (!session) {
    session = await createSession({
      channelId,
      messageTs,
      threadTs: effectiveThreadTs,
      userId,
      originalQuestion: processedMessageText,
      threadContext,
      username: userInfo?.username,
      displayName: userInfo?.displayName,
      triggerType: ctx.triggerType,
      additionalSystemPrompt: ctx.additionalSystemPrompt,
    });
    logger.debug(`Created session ${session.sessionId}`);
  } else {
    await updateThreadContext(session.sessionId, threadContext);
    const updates: Record<string, unknown> = {
      originalQuestion: processedMessageText,
      triggerType: ctx.triggerType,
    };
    if (!session.username && userInfo?.username) updates.username = userInfo.username;
    if (!session.displayName && userInfo?.displayName) updates.displayName = userInfo.displayName;
    await updateSession(session.sessionId, updates);
    session = (await getSession(session.sessionId))!;
  }

  activeSessions.set(session.sessionId, {
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
 * Returns DM coordinates if setup succeeded, null to fall back to thread mode.
 */
async function setupDmDelivery(ctx: ProcessingContext, session: SessionContext): Promise<DmCoordinates | null> {
  const dmChannel = await openDmChannel(ctx.client, ctx.userId);
  if (!dmChannel) {
    logger.warn("DM delivery failed, falling back to thread mode");
    return null;
  }

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
  const dmThreadTs = parent.ts ?? undefined;

  // Store DM coordinates in the session
  await storeDmCoordinates(
    session.sessionId,
    dmChannel,
    dmThreadTs || ctx.effectiveThreadTs,
    ctx.channelId,
    ctx.effectiveThreadTs,
  );

  return { dmChannel, dmThreadTs };
}

// ============================================================
// IN-FLIGHT REQUEST TRACKING
// ============================================================

/**
 * Register an in-flight request for cancellation support (mentions and DMs only),
 * execute the callback, and deregister when done.
 */
async function withInFlightTracking(
  info: {
    channelId: string;
    messageTs: string;
    triggerType: TriggerType;
    sessionId: string;
    abortController: AbortController;
  },
  fn: () => Promise<unknown>,
): Promise<void> {
  const cancellableTrigger = info.triggerType === "mentions" || info.triggerType === "directMessages"
    ? info.triggerType
    : null;
  if (cancellableTrigger) {
    registerInFlightRequest(info.channelId, info.messageTs, {
      abortController: info.abortController,
      sessionId: info.sessionId,
      triggerType: cancellableTrigger,
    });
  }
  try {
    await fn();
  } finally {
    if (cancellableTrigger) {
      deregisterInFlightRequest(info.channelId, info.messageTs);
    }
  }
}

// ============================================================
// ASSISTANT CONTEXT
// ============================================================

/**
 * Store the assistant panel's current channel on the session.
 * Sets originChannelId on first use so follow-ups know where the conversation started.
 */
async function storeAssistantContext(
  session: SessionContext,
  assistantChannelId: string,
): Promise<SessionContext> {
  const currentSession = await getSession(session.sessionId);
  const updates: Record<string, unknown> = {
    assistantCurrentChannelId: assistantChannelId,
  };
  if (!currentSession?.assistantOriginChannelId) {
    updates.assistantOriginChannelId = assistantChannelId;
  }
  const updated = await updateSession(session.sessionId, updates);
  return updated ?? session;
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

  const effectiveThreadTs = threadTs || messageTs;

  const ctx: ProcessingContext = {
    client,
    config,
    userId,
    channelId,
    messageTs,
    messageText,
    threadTs,
    effectiveThreadTs,
    triggerType,
    workMode,
    additionalSystemPrompt: params.additionalSystemPrompt,
  };

  const assistantSuffix = params.assistantChannelId ? ` [assistant panel, viewing ${params.assistantChannelId}]` : "";
  logger.debug(`Processing message from ${userId} in ${channelId} (trigger: ${triggerType}, dm: ${isDm})${assistantSuffix}`);

  // 1. Set up or retrieve session
  let session = await setupSession(ctx);

  // 2. DM setup for reaction triggers (before executeAndDeliver sees sessionInfo)
  let dmCoords: DmCoordinates | null = null;
  if (isDm) {
    dmCoords = await setupDmDelivery(ctx, session);
    if (!dmCoords) {
      isDm = false;
    }
  }

  // 3. Store assistant channel context on session before Claude runs
  if (params.assistantChannelId) {
    session = await storeAssistantContext(session, params.assistantChannelId);
  }

  // 4. Update sessionInfo with DM coordinates (if set)
  const sessionInfo = {
    channelId,
    threadTs: effectiveThreadTs,
    userId,
    triggerType,
    ...(dmCoords?.dmChannel && { dmChannel: dmCoords.dmChannel }),
    ...(dmCoords?.dmThreadTs && { dmThreadTs: dmCoords.dmThreadTs }),
  };
  activeSessions.set(session.sessionId, sessionInfo);

  // 5. Collect available images + files from triggering message + thread context
  const imageMap = new Map<string, SlackImageFile>();
  if (params.imageFiles) {
    for (const img of params.imageFiles) imageMap.set(img.id, img);
  }
  const fileMap = new Map<string, SlackFile>();
  if (params.files) {
    for (const f of params.files) fileMap.set(f.id, f);
  }
  for (const msg of session.threadContext) {
    if (msg.imageFiles) {
      for (const img of msg.imageFiles) imageMap.set(img.id, img);
    }
    if (msg.files) {
      for (const f of msg.files) fileMap.set(f.id, f);
    }
  }
  const availableImages = imageMap;
  const availableFiles = fileMap;

  // 6. Build Claude options and execute
  const claudeOptions = await getClaudeOptions(userId, triggerType);
  const abortController = new AbortController();

  await withInFlightTracking(
    { channelId, messageTs, triggerType, sessionId: session.sessionId, abortController },
    () => executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: { ...claudeOptions, workMode, availableImages, availableFiles },
      abortController,
    }),
  );
}
