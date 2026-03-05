import type { App } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { ClaudeResponse, ConversationMessage } from "../../claude.js";
import {
  findSessionByThread,
  createSession,
  getSession,
  updateSession,
  updateThreadContext,
  setLastAnswer,
  addError,
} from "../../sessions.js";
import { getConfig, type Config } from "../../config.js";
import { logger } from "../../logger.js";
import { askClaude, analyzeError } from "../../claude.js";
import {
  getMessageBlocks,
  getStructuredResponseBlocks,
  getResponseActionBlocks,
  getErrorBlocksWithRetry,
} from "../blocks.js";
import { setSessionInfo } from "../state.js";
import {
  fetchThreadContext,
  sendErrorReport,
} from "../messagesApi.js";
import { transformUserMentions } from "../userCache.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { handleAutoExecuteActions } from "./autoExecute.js";
import { getReactionDelivery } from "../../userPreferences.js";
import { registerInFlightRequest, deregisterInFlightRequest } from "../inFlightRequests.js";
import { storeDmCoordinates } from "../dmResponse.js";
import { SlackStreamer } from "../../streaming/slackStreamer.js";

export type TriggerType = "directMessages" | "mentions" | "reactions";

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
  /** Slack team ID (set during session setup, passed to streamer) */
  teamId?: string;
}

// ============================================================
// SESSION SETUP
// ============================================================

async function setupSession(ctx: ProcessingContext): Promise<SessionContext> {
  const { client, config, userId, channelId, messageTs, messageText, threadTs, effectiveThreadTs } = ctx;

  const authResult = await client.auth.test();
  const botUserId = authResult.user_id || "";
  ctx.teamId = authResult.team_id;

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
// STREAM SETUP
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
 * Create a SlackStreamer targeting the right channel/thread for this context.
 * For DM-mode reactions: opens a DM and targets that.
 * For everything else: targets the channel thread.
 */
async function createStreamer(ctx: ProcessingContext): Promise<SlackStreamer> {
  if (ctx.isDm) {
    const dmChannel = await openDmChannel(ctx.client, ctx.userId);
    if (dmChannel) {
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
      return new SlackStreamer({
        client: ctx.client,
        channel: dmChannel,
        threadTs: parent.ts || ctx.effectiveThreadTs,
        userId: ctx.userId,
        teamId: ctx.teamId,
      });
    }
    // DM failed — fall back to thread mode
    logger.warn("DM delivery failed, falling back to thread mode");
    ctx.isDm = false;
  }

  return new SlackStreamer({
    client: ctx.client,
    channel: ctx.channelId,
    threadTs: ctx.effectiveThreadTs,
    userId: ctx.userId,
    teamId: ctx.teamId,
  });
}

// ============================================================
// SUCCESS RESPONSE HANDLING
// ============================================================

async function persistResponseState(
  session: SessionContext,
  response: ClaudeResponse
): Promise<void> {
  await setLastAnswer(session.sessionId, response.answer);

  const sessionUpdates: Record<string, unknown> = {};
  if (response.response) {
    sessionUpdates.lastResponse = response.response;
  }
  if (response.stagedIntents && Object.keys(response.stagedIntents).length > 0) {
    sessionUpdates.stagedIntents = response.stagedIntents;
  }
  if (response.toolCallHistory && response.toolCallHistory.length > 0) {
    sessionUpdates.toolCallHistory = response.toolCallHistory;
  }
  if (Object.keys(sessionUpdates).length > 0) {
    await updateSession(session.sessionId, sessionUpdates as any);
  }
}

/**
 * Stop the stream with the response content and action buttons.
 */
async function stopStreamWithResponse(
  streamer: SlackStreamer,
  session: SessionContext,
  response: ClaudeResponse
): Promise<void> {
  // Only include action buttons in blocks — the answer text is already in markdownText.
  // Including answer sections would duplicate the content.
  const actionBlocks = response.response
    ? getResponseActionBlocks(response.response.actions, session.sessionId)
    : [];

  await streamer.stop({
    markdownText: response.answer,
    ...(actionBlocks.length > 0 && { blocks: actionBlocks as any[] }),
  });
}

// ============================================================
// ERROR HANDLING
// ============================================================

async function handleErrorResponse(
  ctx: ProcessingContext,
  session: SessionContext,
  response: ClaudeResponse,
  streamer: SlackStreamer
): Promise<void> {
  const { client, config, userId } = ctx;

  logger.error("Claude failed:", response.error);

  const errorMessage = response.error || "Unknown error";
  const conversationTrace = response.conversationTrace || [];

  await addError(session.sessionId, errorMessage, conversationTrace);

  const isPlatformLimit = /usage limit|limit reached/i.test(errorMessage);
  const errorText = isPlatformLimit
    ? errorMessage
    : `Claude seems to have crashed (session: ${session.sessionId}), maybe try again?`;

  // Stop the stream with error info
  if (streamer.hasFailed) {
    await streamer.stop();
    const targetChannel = ctx.isDm && ctx.dmChannel ? ctx.dmChannel : ctx.channelId;
    const targetThread = ctx.isDm && ctx.dmThreadTs ? ctx.dmThreadTs : ctx.effectiveThreadTs;
    await client.chat.postMessage({
      channel: targetChannel,
      thread_ts: targetThread,
      blocks: getErrorBlocksWithRetry(session.sessionId) as any[],
      text: errorText,
    });
  } else {
    await streamer.stop({
      markdownText: errorText,
      blocks: getErrorBlocksWithRetry(session.sessionId) as any[],
    });
  }

  if (config.slack.sendErrorsAsDM) {
    await sendErrorDM(client, userId, session.sessionId, errorMessage, conversationTrace);
  }
}

async function sendErrorDM(
  client: App["client"],
  userId: string,
  sessionId: string,
  errorMessage: string,
  conversationTrace: ConversationMessage[]
): Promise<void> {
  try {
    const analysis = await analyzeError(errorMessage, conversationTrace);
    await sendErrorReport(client, userId, {
      sessionId,
      errorMessage,
      conversationTrace,
      analysis,
    });
  } catch (dmError) {
    logger.error("Failed to send error report DM:", dmError);
  }
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

  logger.debug(`Processing message from ${userId} in ${channelId} (trigger: ${triggerType}, dm: ${isDm})`);

  // 1. Set up or retrieve session
  const session = await setupSession(ctx);

  // 2. Create streamer targeting the right channel/thread
  const streamer = await createStreamer(ctx);

  // 3. Start the stream
  const streamStarted = await streamer.start();
  if (!streamStarted) {
    logger.warn("Stream failed to start, will fall back to one-shot posting");
  }

  try {
    // Store DM coordinates in session if DM mode was used
    if (ctx.isDm && ctx.dmChannel && ctx.dmThreadTs) {
      await storeDmCoordinates(
        session.sessionId,
        ctx.dmChannel,
        ctx.dmThreadTs,
        channelId,
        ctx.effectiveThreadTs
      );
    }
    // 4. Call Claude with streaming events
    const claudeOptions = await getClaudeOptions(userId, triggerType);
    const abortController = new AbortController();

    // Register in-flight request for cancellation support (mentions and DMs only)
    const canCancel = triggerType === "mentions" || triggerType === "directMessages";
    if (canCancel) {
      registerInFlightRequest(channelId, messageTs, {
        abortController,
        sessionId: session.sessionId,
        triggerType,
      });
    }

    let response: ClaudeResponse;
    try {
      logger.info(
        `Calling Claude (session: ${session.sessionId}, trigger: ${triggerType}, role: ${claudeOptions.role ?? "member"}, changesWorkflow: ${claudeOptions.changesWorkflowEnabled ?? false})`
      );
      response = await askClaude(session, {
        ...claudeOptions,
        workMode: ctx.workMode,
        slackClient: client,
        abortController,
        onEvent: streamer.handleEvent,
      });
    } finally {
      if (canCancel) {
        deregisterInFlightRequest(channelId, messageTs);
      }
    }

    // If cancelled via message edit, stop the stream and bail
    if (response.cancelled) {
      await streamer.stop({ markdownText: "_Request cancelled._" });
      if (streamer.hasFailed) {
        const targetChannel = ctx.isDm && ctx.dmChannel ? ctx.dmChannel : channelId;
        const targetThread = ctx.isDm && ctx.dmThreadTs ? ctx.dmThreadTs : ctx.effectiveThreadTs;
        await client.chat.postMessage({
          channel: targetChannel,
          thread_ts: targetThread,
          text: "_Request cancelled._",
        });
      }
      return;
    }

    // 5. Handle response
    if (response.success) {
      await persistResponseState(session, response);

      if (streamer.hasFailed) {
        // Stream broke mid-flight — stop it to clear the loading state, then fall back
        await streamer.stop();
        const blocks = response.renderedBlocks
          ?? (response.response
            ? getStructuredResponseBlocks(response.response, session.sessionId)
            : getMessageBlocks(response.answer));
        const targetChannel = ctx.isDm && ctx.dmChannel ? ctx.dmChannel : channelId;
        const targetThread = ctx.isDm && ctx.dmThreadTs ? ctx.dmThreadTs : ctx.effectiveThreadTs;
        await client.chat.postMessage({
          channel: targetChannel,
          thread_ts: targetThread,
          blocks: blocks as any[],
          text: response.answer,
        });
      } else {
        await stopStreamWithResponse(streamer, session, response);
      }

      // Auto-execute any actions flagged with auto: true
      await handleAutoExecuteActions({
        client,
        channelId,
        threadTs: ctx.effectiveThreadTs,
        userId,
        response,
        sessionId: session.sessionId,
        role: claudeOptions.role ?? "member",
        dmChannel: ctx.dmChannel,
        dmThreadTs: ctx.dmThreadTs,
      });
    } else {
      await handleErrorResponse(ctx, session, response, streamer);
    }
  } catch (error) {
    logger.error("Unhandled error in processMessage:", error);
    try {
      await streamer.stop({ markdownText: "Something went wrong processing this request." });
      if (streamer.hasFailed) {
        const targetChannel = ctx.isDm && ctx.dmChannel ? ctx.dmChannel : channelId;
        const targetThread = ctx.isDm && ctx.dmThreadTs ? ctx.dmThreadTs : ctx.effectiveThreadTs;
        await client.chat.postMessage({
          channel: targetChannel,
          thread_ts: targetThread,
          text: "Something went wrong processing this request.",
        });
      }
    } catch {
      // Last resort — stream is unrecoverable
    }
  } finally {
    // Ensure stream is stopped to prevent orphaned streams (idempotent — no-op if already stopped)
    await streamer.stop();
  }
}
