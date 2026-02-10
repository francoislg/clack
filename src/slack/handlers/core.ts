import type { App } from "@slack/bolt";
import { ErrorCode, type WebAPIPlatformError } from "@slack/web-api";
import type { SessionContext } from "../../sessions.js";
import type { ClaudeResponse, ConversationMessage } from "../../claude.js";
import {
  findSessionByThread,
  createSession,
  getSession,
  updateThreadContext,
  setLastAnswer,
  addError,
} from "../../sessions.js";
import { getConfig, type Config } from "../../config.js";
import { logger } from "../../logger.js";
import { askClaude, analyzeError } from "../../claude.js";
import {
  getMessageBlocks,
  getResponseBlocks,
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
import { detectFollowUpCommand } from "../../changes/detection.js";
import { handleFollowUp } from "../../changes/workflow.js";
import {
  getChangeDetectionOptions,
  handleChangeRequest,
  handleResumeRequest,
} from "./changeWorkflowHelper.js";

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
}

interface ThinkingState {
  messageTs?: string;
  usedEmoji: boolean;
  emoji?: string;
}

// ============================================================
// CHANGE SESSION FOLLOW-UP HANDLING
// ============================================================

async function tryHandleChangeSessionFollowUp(ctx: ProcessingContext): Promise<boolean> {
  const { client, channelId, messageText, threadTs } = ctx;

  if (!threadTs) return false;

  const changeSession = getSessionByThread(channelId, threadTs);
  if (!changeSession) return false;

  const detection = await detectFollowUpCommand(
    messageText,
    changeSession.worktree.worktreePath
  );

  if (!detection.isCommand || !detection.info) return false;

  const { command, additionalInstructions } = detection.info;
  logger.debug(`Detected follow-up command "${command}" in change thread ${threadTs}`);

  const ackMessage = await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `Processing ${command} command...`,
  });

  const result = await handleFollowUp(
    changeSession,
    command,
    additionalInstructions,
    async (progressMessage: string) => {
      try {
        await client.chat.update({
          channel: channelId,
          ts: ackMessage.ts!,
          text: progressMessage,
        });
      } catch (error) {
        logger.warn("Failed to update progress message:", error);
      }
    }
  );

  if (result.success) {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `✅ ${result.summary || "Done!"}${result.prUrl ? `\n${result.prUrl}` : ""}`,
    });
  } else {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `❌ ${result.error || "Command failed"}`,
    });
  }

  return true;
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
    session = (await getSession(session.sessionId))!;
  }

  setSessionInfo(session.sessionId, {
    channelId,
    threadTs: effectiveThreadTs,
    userId,
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
  answer: string,
  thinkingMessageTs?: string
): Promise<void> {
  const { client, config, userId, channelId, effectiveThreadTs, isEphemeral } = ctx;

  logger.debug("Posting Claude response...");
  await setLastAnswer(session.sessionId, answer);

  if (isEphemeral) {
    await postEphemeralResponse(ctx, session, answer);
  } else if (thinkingMessageTs) {
    await client.chat.update({
      channel: channelId,
      ts: thinkingMessageTs,
      blocks: getMessageBlocks(answer),
      text: answer,
    });
  } else {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: effectiveThreadTs,
      blocks: getMessageBlocks(answer),
      text: answer,
    });
  }
}

async function postEphemeralResponse(
  ctx: ProcessingContext,
  session: SessionContext,
  answer: string
): Promise<void> {
  const { client, config, userId, channelId, effectiveThreadTs } = ctx;

  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    thread_ts: effectiveThreadTs,
    blocks: getResponseBlocks(answer, session.sessionId),
    text: answer,
  });

  if (config.slack.notifyHiddenThread) {
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
// CHANGE/RESUME REQUEST ROUTING
// ============================================================

async function handleSpecialResponses(
  ctx: ProcessingContext,
  response: ClaudeResponse,
  thinkingMessageTs?: string
): Promise<boolean> {
  const { client, userId, channelId, messageTs, messageText, threadTs, triggerType } = ctx;

  if (response.isChangeRequest && response.changeRequestInfo) {
    logger.debug("Claude detected change request, routing to change workflow...");
    if (thinkingMessageTs) {
      await client.chat.update({
        channel: channelId,
        ts: thinkingMessageTs,
        text: "Starting change request...",
      });
    }
    await handleChangeRequest(
      client,
      userId,
      channelId,
      messageTs,
      messageText,
      response.changeRequestInfo,
      triggerType,
      threadTs
    );
    return true;
  }

  if (response.isResumeRequest && response.resumeRequestInfo) {
    logger.debug(`Claude detected resume request for branch ${response.resumeRequestInfo.branchName}...`);
    if (thinkingMessageTs) {
      await client.chat.update({
        channel: channelId,
        ts: thinkingMessageTs,
        text: "Resuming previous session...",
      });
    }
    await handleResumeRequest(
      client,
      userId,
      channelId,
      messageTs,
      messageText,
      response.resumeRequestInfo,
      triggerType,
      threadTs
    );
    return true;
  }

  return false;
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
  } = params;

  const config = getConfig();
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
    isEphemeral: responseStyle === "ephemeral",
  };

  logger.debug(`Processing message from ${userId} in ${channelId} (trigger: ${triggerType})`);

  // 1. Check for active change session follow-up
  if (await tryHandleChangeSessionFollowUp(ctx)) {
    return;
  }

  // 2. Set up or retrieve session
  const session = await setupSession(ctx);

  // 3. Show thinking feedback
  const thinking = await showThinkingFeedback(ctx);

  // 4. Call Claude
  const changeOptions = await getChangeDetectionOptions(userId, triggerType);

  logger.info(
    `Calling Claude (session: ${session.sessionId}, changeDetection: ${changeOptions?.enableChangeDetection ?? false})`
  );
  const response = await askClaude(session, changeOptions);

  // 5. Remove thinking emoji if used
  await removeThinkingEmoji(client, channelId, messageTs, thinking);

  // 6. Handle response
  if (response.success) {
    // Check for change/resume requests first
    if (await handleSpecialResponses(ctx, response, thinking.messageTs)) {
      return;
    }
    // Regular Q&A response
    await postSuccessResponse(ctx, session, response.answer, thinking.messageTs);
  } else {
    await handleErrorResponse(ctx, session, response, thinking.messageTs);
  }
}
