import type { App } from "@slack/bolt";
import { ErrorCode, type WebAPIPlatformError } from "@slack/web-api";
import type { SessionContext } from "../../sessions.js";
import type { ClaudeResponse, ConversationMessage, AskClaudeOptions } from "../../claude.js";
import {
  findSessionByThread,
  createSession,
  getSession,
  updateSession,
  updateThreadContext,
  setLastAnswer,
  addError,
  addRefinement,
} from "../../sessions.js";
import { getConfig, type Config } from "../../config.js";
import { logger } from "../../logger.js";
import { askClaude, analyzeError } from "../../claude.js";
import {
  getMessageBlocks,
  getStructuredResponseBlocks,
  getInvestigatingBlocks,
  getErrorBlocksWithRetry,
  getHiddenThreadNotificationBlocks,
} from "../blocks.js";
import { setSessionInfo } from "../state.js";
import {
  fetchThreadContext,
  sendErrorReport,
  hasThreadReplies,
  sendDirectMessage,
} from "../messagesApi.js";
import { transformUserMentions } from "../userCache.js";
import { getSessionByThread } from "../../changes/session.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { handleAutoExecuteActions } from "./autoExecute.js";
import { getEffectiveResponseType } from "../../userPreferences.js";
import {
  postDmInvestigationNotice,
  postDmThreadReply,
  storeDmCoordinates,
} from "../dmResponse.js";

export type TriggerType = "directMessages" | "mentions" | "reactions";
export type ResponseStyle = "regular" | "ephemeral";

export interface ProcessMessageParams {
  client: App["client"];
  userId: string;
  channelId: string;
  messageTs: string;
  messageText: string;
  threadTs?: string;
  triggerType: TriggerType;
  responseStyle?: ResponseStyle;
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
  isEphemeral: boolean;
  /** DM-first delivery mode for reactions */
  isDmFirst: boolean;
  /** DM channel ID (set during DM-first flow) */
  dmChannel?: string;
  /** DM thread ts (set during DM-first flow) */
  dmThreadTs?: string;
  /** When true, hints Claude to propose a change with auto-execute */
  workMode: boolean;
}

interface ThinkingState {
  messageTs?: string;
  usedEmoji: boolean;
  emoji?: string;
}

// ============================================================
// SESSION SETUP
// ============================================================

async function setupSession(ctx: ProcessingContext): Promise<SessionContext> {
  const { client, config, userId, channelId, messageTs, messageText, threadTs, effectiveThreadTs } = ctx;

  const botUserId = (await client.auth.test()).user_id || "";

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
    isEphemeral: ctx.isEphemeral,
  });

  setSessionInfo(session.sessionId, {
    channelId,
    threadTs: effectiveThreadTs,
    userId,
    isEphemeral: ctx.isEphemeral,
    triggerType: ctx.triggerType,
  });

  return session;
}

// ============================================================
// THINKING FEEDBACK
// ============================================================

async function showThinkingFeedback(ctx: ProcessingContext): Promise<ThinkingState> {
  const { client, config, userId, channelId, messageTs, effectiveThreadTs, triggerType, isEphemeral } = ctx;
  const thinkingFeedback = config[triggerType].thinking;

  if (thinkingFeedback?.type === "emoji" && thinkingFeedback.emoji) {
    try {
      await client.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: thinkingFeedback.emoji,
      });
    } catch (error) {
      logger.error("Failed to add thinking reaction:", error);
    }
    return { usedEmoji: true, emoji: thinkingFeedback.emoji };
  }

  if (isEphemeral) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: "Acknowledged, sending to Claude...",
    });
    return { usedEmoji: false };
  }

  const thinkingMessage = await client.chat.postMessage({
    channel: channelId,
    thread_ts: effectiveThreadTs,
    blocks: getInvestigatingBlocks(),
    text: "Investigating...",
  });

  return { messageTs: thinkingMessage.ts, usedEmoji: false };
}

function isSlackPlatformError(
  error: unknown,
  code: string
): error is WebAPIPlatformError {
  return (
    error instanceof Error &&
    (error as WebAPIPlatformError).code === ErrorCode.PlatformError &&
    (error as WebAPIPlatformError).data?.error === code
  );
}

async function removeThinkingEmoji(
  client: App["client"],
  channelId: string,
  messageTs: string,
  thinking: ThinkingState
): Promise<void> {
  if (!thinking.usedEmoji || !thinking.emoji) return;

  try {
    await client.reactions.remove({
      channel: channelId,
      timestamp: messageTs,
      name: thinking.emoji,
    });
  } catch (error) {
    if (!isSlackPlatformError(error, "no_reaction")) {
      logger.error("Failed to remove thinking reaction:", error);
    }
  }
}

// ============================================================
// SUCCESS RESPONSE HANDLING
// ============================================================

async function postSuccessResponse(
  ctx: ProcessingContext,
  session: SessionContext,
  response: ClaudeResponse,
  thinkingMessageTs?: string
): Promise<void> {
  const { client, channelId, effectiveThreadTs, isEphemeral } = ctx;

  logger.debug("Posting Claude response...");
  await setLastAnswer(session.sessionId, response.answer);

  // Persist tool-related state for button handlers and session reconstruction
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

  if (ctx.isDmFirst && ctx.dmChannel && ctx.dmThreadTs) {
    await postDmThreadReply(client, ctx.dmChannel, ctx.dmThreadTs, session, response);
    return;
  }

  if (isEphemeral) {
    await postEphemeralResponse(ctx, session, response);
  } else {
    // Use pre-rendered blocks from submit_response when available (already validated)
    const blocks = response.renderedBlocks
      ?? (response.response
        ? getStructuredResponseBlocks(response.response, session.sessionId)
        : getMessageBlocks(response.answer));

    if (thinkingMessageTs) {
      await client.chat.update({
        channel: channelId,
        ts: thinkingMessageTs,
        blocks: blocks as any[],
        text: response.answer,
      });
    } else {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: effectiveThreadTs,
        blocks: blocks as any[],
        text: response.answer,
      });
    }
  }
}

async function postEphemeralResponse(
  ctx: ProcessingContext,
  session: SessionContext,
  response: ClaudeResponse
): Promise<void> {
  const { client, config, userId, channelId, effectiveThreadTs } = ctx;

  if (response.response) {
    const blocks = response.renderedBlocks
      ?? getStructuredResponseBlocks(response.response, session.sessionId);
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      blocks: blocks as any[],
      text: response.answer,
    });
  } else {
    // No structured response — render text only
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: response.answer,
    });
  }

  if (config.slack.notifyHiddenThread && !ctx.isDmFirst) {
    await notifyHiddenThread(ctx, session.sessionId);
  }
}

async function notifyHiddenThread(ctx: ProcessingContext, sessionId: string): Promise<void> {
  const { client, userId, channelId, effectiveThreadTs } = ctx;

  const threadHasReplies = await hasThreadReplies(client, channelId, effectiveThreadTs);
  if (threadHasReplies) return;

  try {
    const permalink = await client.chat.getPermalink({
      channel: channelId,
      message_ts: effectiveThreadTs,
    });
    if (permalink.permalink) {
      const threadLink = `${permalink.permalink}?thread_ts=${effectiveThreadTs}&cid=${channelId}`;
      const text = `Clack answered your question, but the thread isn't visible yet. Click here to see it: ${threadLink}`;
      const blocks = getHiddenThreadNotificationBlocks(text, sessionId);
      await sendDirectMessage(client, userId, text, blocks);
    }
  } catch (error) {
    logger.error("Failed to send hidden thread notification:", error);
  }
}

// ============================================================
// ERROR HANDLING
// ============================================================

async function handleErrorResponse(
  ctx: ProcessingContext,
  session: SessionContext,
  response: ClaudeResponse,
  thinkingMessageTs?: string
): Promise<void> {
  const { client, config, userId, channelId, effectiveThreadTs, isEphemeral } = ctx;

  logger.error("Claude failed:", response.error);

  const errorMessage = response.error || "Unknown error";
  const conversationTrace = response.conversationTrace || [];

  await addError(session.sessionId, errorMessage, conversationTrace);

  const errorText = `Claude seems to have crashed (session: ${session.sessionId}), maybe try again?`;

  if (isEphemeral) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: errorText,
      blocks: getErrorBlocksWithRetry(session.sessionId),
    });
  } else if (thinkingMessageTs) {
    await client.chat.update({
      channel: channelId,
      ts: thinkingMessageTs,
      blocks: getErrorBlocksWithRetry(session.sessionId),
      text: errorText,
    });
  } else {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: effectiveThreadTs,
      blocks: getErrorBlocksWithRetry(session.sessionId),
      text: errorText,
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
// BLOCK VALIDATION RETRY
// ============================================================

function isSlackBlockError(error: unknown): error is WebAPIPlatformError {
  if (!(error instanceof Error)) return false;
  const code = (error as WebAPIPlatformError).data?.error;
  return (
    (error as WebAPIPlatformError).code === ErrorCode.PlatformError &&
    (code === "invalid_blocks" || code === "msg_too_long")
  );
}

async function retryWithBlockError(
  ctx: ProcessingContext,
  session: SessionContext,
  claudeOptions: AskClaudeOptions,
  changeSession: import("../../changes/types.js").ChangeSession | undefined,
  postError: unknown
): Promise<ClaudeResponse | null> {
  const slackError = (postError as WebAPIPlatformError).data?.error ?? "unknown";
  const errorDetail = (postError as WebAPIPlatformError).data?.response_metadata?.messages?.join("; ")
    || `Slack rejected the message with ${slackError}.`;

  await addRefinement(
    session.sessionId,
    `SYSTEM: Your previous submit_response was rejected by Slack with error "${slackError}". Detail: ${errorDetail}. Your response is too long or has too many sections. Please significantly shorten your answer and call submit_response again.`
  );

  const updatedSession = await getSession(session.sessionId);
  if (!updatedSession) {
    logger.error("Could not reload session for block validation retry");
    return null;
  }

  logger.info(`Retrying Claude for block validation (session: ${session.sessionId})...`);
  const retryResponse = await askClaude(updatedSession, {
    ...claudeOptions,
    changeSession: changeSession || undefined,
  });

  if (!retryResponse.success) {
    await handleErrorResponse(ctx, session, retryResponse);
    return null;
  }

  return retryResponse;
}

async function postPlainTextFallback(
  ctx: ProcessingContext,
  response: ClaudeResponse,
  thinkingMessageTs?: string
): Promise<void> {
  const { client, userId, channelId, effectiveThreadTs, isEphemeral } = ctx;

  if (isEphemeral) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: response.answer,
    });
  } else if (thinkingMessageTs) {
    await client.chat.update({
      channel: channelId,
      ts: thinkingMessageTs,
      text: response.answer,
    });
  } else {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: effectiveThreadTs,
      text: response.answer,
    });
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
    responseStyle = "regular",
    workMode = false,
  } = params;

  const config = getConfig();

  // Resolve DM-first for reaction triggers
  let isDmFirst = false;
  if (triggerType === "reactions" && responseStyle === "ephemeral") {
    const effectiveType = await getEffectiveResponseType(userId);
    isDmFirst = effectiveType === "directMessage";
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
    isEphemeral: isDmFirst ? false : responseStyle === "ephemeral",
    isDmFirst,
    workMode,
  };

  logger.debug(`Processing message from ${userId} in ${channelId} (trigger: ${triggerType}, dmFirst: ${isDmFirst})`);

  // 1. Check for active change session in thread (for tool context)
  const changeSession = threadTs ? getSessionByThread(channelId, threadTs) : undefined;

  // 2. Set up or retrieve session
  const session = await setupSession(ctx);

  // 3. For DM-first: post investigation notice in DM (replaces thinking feedback)
  //    For others: show regular thinking feedback
  let thinking: ThinkingState;
  if (isDmFirst) {
    const dmResult = await postDmInvestigationNotice(
      client,
      userId,
      channelId,
      ctx.effectiveThreadTs,
      session.sessionId
    );

    if (dmResult) {
      ctx.dmChannel = dmResult.dmChannel;
      ctx.dmThreadTs = dmResult.dmThreadTs;

      // Store DM coordinates in session
      await storeDmCoordinates(
        session.sessionId,
        dmResult.dmChannel,
        dmResult.dmThreadTs,
        channelId,
        ctx.effectiveThreadTs
      );
    } else {
      // DM failed — fall back to ephemeral
      logger.warn("DM-first delivery failed, falling back to ephemeral");
      ctx.isDmFirst = false;
      ctx.isEphemeral = true;
    }
    thinking = { usedEmoji: false };
  } else {
    thinking = await showThinkingFeedback(ctx);
  }

  // 4. Call Claude with change session context for follow-up tools
  const claudeOptions = await getClaudeOptions(userId, triggerType);

  logger.info(
    `Calling Claude (session: ${session.sessionId}, role: ${claudeOptions.role ?? "member"}, changesWorkflow: ${claudeOptions.changesWorkflowEnabled ?? false})`
  );
  const response = await askClaude(session, {
    ...claudeOptions,
    changeSession: changeSession || undefined,
    workMode: ctx.workMode,
    isEphemeral: ctx.isEphemeral,
    triggerType: ctx.triggerType,
    isDmFirst: ctx.isDmFirst,
  });

  // 5. Remove thinking emoji if used
  await removeThinkingEmoji(client, channelId, messageTs, thinking);

  // 6. Handle response (with retry on block errors)
  let postedResponse: ClaudeResponse | undefined;
  if (response.success) {
    try {
      await postSuccessResponse(ctx, session, response, thinking.messageTs);
      postedResponse = response;
    } catch (postError) {
      if (isSlackBlockError(postError)) {
        const errorCode = (postError as WebAPIPlatformError).data?.error;
        logger.warn(`${errorCode} error posting response for session ${session.sessionId}, retrying via Claude...`);
        const retryResponse = await retryWithBlockError(ctx, session, claudeOptions, changeSession, postError);
        if (retryResponse) {
          try {
            await postSuccessResponse(ctx, session, retryResponse, thinking.messageTs);
            postedResponse = retryResponse;
          } catch (retryPostError) {
            // Exhausted retries — fall back to plain text
            logger.warn("Retry also produced invalid/too-long blocks, falling back to plain text");
            await postPlainTextFallback(ctx, retryResponse, thinking.messageTs);
          }
        }
      } else {
        throw postError;
      }
    }
  } else {
    await handleErrorResponse(ctx, session, response, thinking.messageTs);
  }

  // 7. Auto-execute any actions flagged with auto: true
  if (postedResponse) {
    await handleAutoExecuteActions({
      client,
      channelId,
      threadTs: ctx.effectiveThreadTs,
      userId,
      response: postedResponse,
      changeSession,
      role: claudeOptions.role ?? "member",
    });
  }
}
