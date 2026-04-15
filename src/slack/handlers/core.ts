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
import { getChannelInfo } from "../channelCache.js";
import { openDmChannel } from "../channelResolver.js";
import { resolveChannelLabel, resolveUserLabel, slackLink } from "../logContext.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { getReactionDelivery } from "../../userPreferences.js";
import { registerInFlightRequest, deregisterInFlightRequest } from "../inFlightRequests.js";
import { storeDmCoordinates } from "../dmResponse.js";
import { executeAndDeliver } from "./handlerResponse.js";
import type { TriggerType } from "../../changes/types.js";
import type { SlackImageFile, SlackFile } from "../slackFileBase.js";
import type { AskClaudeOptions } from "../../claude/index.js";
import type { SessionInfo } from "../activeSessions.js";

export interface CoreDeps {
  findSessionByThread: (channelId: string, threadTs: string) => Promise<SessionContext | null>;
  createSession: (params: Parameters<typeof createSession>[0]) => Promise<SessionContext>;
  getSession: (sessionId: string) => Promise<SessionContext | null>;
  updateSession: (
    sessionId: string,
    updates: Partial<SessionContext>,
  ) => Promise<SessionContext | null>;
  updateThreadContext: (sessionId: string, context: unknown[]) => Promise<SessionContext | null>;
  getConfig: () => Config;
  setSessionInfo: (sessionId: string, info: SessionInfo) => void;
  fetchThreadContext: typeof fetchThreadContext;
  transformUserMentions: (client: App["client"], text: string) => Promise<string>;
  getUserInfo: typeof getUserInfo;
  getChannelInfo: typeof getChannelInfo;
  resolveChannelLabel: typeof resolveChannelLabel;
  resolveUserLabel: typeof resolveUserLabel;
  slackLink: typeof slackLink;
  getClaudeOptions: (userId: string, triggerType: TriggerType) => Promise<AskClaudeOptions>;
  getReactionDelivery: (userId: string) => Promise<string>;
  registerInFlightRequest: typeof registerInFlightRequest;
  deregisterInFlightRequest: typeof deregisterInFlightRequest;
  storeDmCoordinates: typeof storeDmCoordinates;
  executeAndDeliver: typeof executeAndDeliver;
}

export const defaultCoreDeps: CoreDeps = {
  findSessionByThread,
  createSession,
  getSession,
  updateSession: updateSession as never,
  updateThreadContext: updateThreadContext as never,
  getConfig,
  setSessionInfo: (sessionId, info) => activeSessions.set(sessionId, info),
  fetchThreadContext,
  transformUserMentions,
  getUserInfo,
  getChannelInfo,
  resolveChannelLabel,
  resolveUserLabel,
  slackLink,
  getClaudeOptions,
  getReactionDelivery,
  registerInFlightRequest,
  deregisterInFlightRequest,
  storeDmCoordinates,
  executeAndDeliver,
};

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
  /** When true, skip streaming UX and post the final result directly */
  silentThinking?: boolean;
  /**
   * Fully-qualified MCP tool names (e.g., `mcp__trivia__submit_answers`) that must be called during
   * this run before `submit_response` will be accepted. Populated by callers like the cron scheduler.
   */
  requiredTools?: string[];
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
  readonly requiredTools?: string[];
}

interface DmCoordinates {
  dmChannel: string;
  dmThreadTs?: string;
}

// ============================================================
// SESSION SETUP
// ============================================================

async function setupSession(ctx: ProcessingContext, deps: CoreDeps): Promise<SessionContext> {
  const { client, config, userId, channelId, messageTs, messageText, threadTs, effectiveThreadTs } =
    ctx;

  const authResult = await client.auth.test();
  const botUserId = authResult.user_id || "";

  const threadContext = threadTs
    ? await deps.fetchThreadContext(client, channelId, threadTs, botUserId, {
        fetchUserNames: config.slack.fetchAndStoreUsername,
      })
    : [];

  // Skip mention resolution for scheduled triggers — their "message text" is a prompt,
  // not a real Slack message, and may contain example mention syntax like <@U123>.
  const processedMessageText =
    config.slack.fetchAndStoreUsername && ctx.triggerType !== "scheduled"
      ? await deps.transformUserMentions(client, messageText)
      : messageText;

  let session = threadTs ? await deps.findSessionByThread(channelId, threadTs) : null;

  // Resolve user and channel info for session attribution
  const userInfo = await deps.getUserInfo(client, userId);
  const channelInfo = await deps.getChannelInfo(client, channelId);

  if (!session) {
    session = await deps.createSession({
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
      channelName: channelInfo?.name,
    });
    logger.debug(`Created session ${session.sessionId}`);
  } else {
    await deps.updateThreadContext(session.sessionId, threadContext);
    const updates: Partial<SessionContext> = {
      originalQuestion: processedMessageText,
      triggerType: ctx.triggerType,
    };
    if (!session.username && userInfo?.username) updates.username = userInfo.username;
    if (!session.displayName && userInfo?.displayName) updates.displayName = userInfo.displayName;
    if (!session.channelName && channelInfo?.name) updates.channelName = channelInfo.name;
    await deps.updateSession(session.sessionId, updates);
    session = (await deps.getSession(session.sessionId))!;
  }

  deps.setSessionInfo(session.sessionId, {
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
 * Set up DM delivery for reaction triggers: open DM, post parent message, store coordinates.
 * Returns DM coordinates if setup succeeded, null to fall back to thread mode.
 */
async function setupDmDelivery(
  ctx: ProcessingContext,
  session: SessionContext,
  deps: CoreDeps,
): Promise<DmCoordinates | null> {
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
  await deps.storeDmCoordinates(
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
  deps: CoreDeps,
): Promise<void> {
  const cancellableTrigger =
    info.triggerType === "mentions" || info.triggerType === "directMessages"
      ? info.triggerType
      : null;
  if (cancellableTrigger) {
    deps.registerInFlightRequest(info.channelId, info.messageTs, {
      abortController: info.abortController,
      sessionId: info.sessionId,
      triggerType: cancellableTrigger,
    });
  }
  try {
    await fn();
  } finally {
    if (cancellableTrigger) {
      deps.deregisterInFlightRequest(info.channelId, info.messageTs);
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
  deps: CoreDeps,
): Promise<SessionContext> {
  const currentSession = await deps.getSession(session.sessionId);
  const updates: Partial<SessionContext> = {
    assistantCurrentChannelId: assistantChannelId,
  };
  if (!currentSession?.assistantOriginChannelId) {
    updates.assistantOriginChannelId = assistantChannelId;
  }
  const updated = await deps.updateSession(session.sessionId, updates);
  return updated ?? session;
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export async function processMessage(
  params: ProcessMessageParams,
  deps: CoreDeps = defaultCoreDeps,
): Promise<void> {
  const {
    client,
    userId,
    channelId,
    messageTs,
    messageText,
    threadTs,
    triggerType,
    workMode = false,
    silentThinking = false,
  } = params;

  const config = deps.getConfig();

  // Resolve DM delivery for reaction triggers based on user preference
  let isDm = false;
  if (triggerType === "reactions") {
    const delivery = await deps.getReactionDelivery(userId);
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
    requiredTools: params.requiredTools,
  };

  const userLabel = await deps.resolveUserLabel(client, userId);
  const channelLabel = await deps.resolveChannelLabel(client, channelId);
  logger.debug(
    `Processing message from ${userLabel} in ${channelLabel} (trigger: ${triggerType}${isDm ? ", dm" : ""})${await deps.slackLink(client, channelId, effectiveThreadTs)}`,
  );

  // 1. Set up or retrieve session
  let session = await setupSession(ctx, deps);

  // 2. DM setup for reaction triggers (before executeAndDeliver sees sessionInfo)
  let dmCoords: DmCoordinates | null = null;
  if (isDm) {
    dmCoords = await setupDmDelivery(ctx, session, deps);
    if (!dmCoords) {
      isDm = false;
    }
  }

  // 3. Store assistant channel context on session before Claude runs
  if (params.assistantChannelId) {
    session = await storeAssistantContext(session, params.assistantChannelId, deps);
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
  deps.setSessionInfo(session.sessionId, sessionInfo);

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
  const claudeOptions = await deps.getClaudeOptions(userId, triggerType);
  const abortController = new AbortController();

  await withInFlightTracking(
    { channelId, messageTs, triggerType, sessionId: session.sessionId, abortController },
    () =>
      deps.executeAndDeliver({
        client,
        session,
        sessionInfo,
        claudeOptions: {
          ...claudeOptions,
          workMode,
          availableImages,
          availableFiles,
          requiredTools: ctx.requiredTools,
        },
        abortController,
        silentThinking,
      }),
    deps,
  );
}
