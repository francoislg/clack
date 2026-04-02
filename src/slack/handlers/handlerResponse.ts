/**
 * Shared response posting and delivery logic.
 *
 * `executeAndDeliver` is the single code path for all Claude → Slack delivery.
 * Trigger-specific callers (processMessage, button handlers) prepare context,
 * then hand off to executeAndDeliver for streaming, delivery, and error handling.
 */
import type { App } from "@slack/bolt";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext } from "../../sessions.js";
import { errorMessage as toErrorMessage } from "../../errors.js";
import type { AskClaudeOptions, ClaudeResponse } from "../../claude/index.js";
import type { DeliverFn } from "../../tools/types.js";
import { getErrorBlocksWithRetry, asSlackBlocks, type SlackBlocks } from "../blocks.js";
import { setLastAnswer, updateSession, addError } from "../../sessions.js";
import { askClaude } from "../../claude/index.js";
import { analyzeError } from "../../claude/utilities.js";
import { sendErrorReport } from "../messagesApi.js";
import { getConfig } from "../../config.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { handleAutoExecuteActions } from "./autoExecute.js";
import { SlackStreamer } from "../../streaming/slackStreamer.js";
import { getUserInfo } from "../userCache.js";
import { getUserPreference } from "../../userPreferences.js";
import { logger } from "../../logger.js";

// ============================================================
// EXECUTE AND DELIVER
// ============================================================

export interface ExecuteAndDeliverParams {
  client: App["client"];
  session: SessionContext;
  sessionInfo: SessionInfo;
  claudeOptions: AskClaudeOptions;
  abortController?: AbortController;
  /** When true, skip SlackStreamer and post the final result directly (no thinking indicators) */
  silentThinking?: boolean;
}

/** Internal context shared by executeAndDeliver and its helpers. */
interface DeliveryContext {
  client: App["client"];
  session: SessionContext;
  sessionInfo: SessionInfo;
  claudeOptions: AskClaudeOptions;
  streamer: SlackStreamer | null;
  targetChannel: string;
  targetThread: string;
  alreadyDelivered: boolean;
  startTime: number;
  silentThinking: boolean;
}

/**
 * Single code path for all Claude → Slack delivery.
 * Trigger-agnostic: reads sessionInfo to derive target channel/thread.
 * Handles streaming, delivery via submit_response, error reporting, and auto-execute.
 */
export async function executeAndDeliver(params: ExecuteAndDeliverParams): Promise<ClaudeResponse> {
  const { client, session, sessionInfo, claudeOptions, abortController, silentThinking = false } = params;

  // Derive target from sessionInfo (DM-aware)
  const targetChannel = sessionInfo.dmChannel ?? sessionInfo.channelId;
  const targetThread = sessionInfo.dmThreadTs ?? sessionInfo.threadTs;

  const userInfo = await getUserInfo(client, sessionInfo.userId);

  // Create streamer only for interactive sessions
  let streamer: SlackStreamer | null = null;
  if (!silentThinking) {
    // Slack's streaming API requires a human user as recipient — bot users cause
    // channel_type_not_supported errors. Fall back to the bot's own user ID when
    // the session user is a bot (e.g., auto-respond triggered by a Sentry message).
    let streamUserId = sessionInfo.userId;
    if (userInfo?.isBot || sessionInfo.userId === "auto-respond") {
      const authResult = await client.auth.test();
      streamUserId = authResult.user_id ?? streamUserId;
    }

    streamer = new SlackStreamer({
      client,
      channel: targetChannel,
      threadTs: targetThread,
      userId: streamUserId,
    });

    const streamStarted = await streamer.start();
    if (!streamStarted) {
      logger.warn("Stream failed to start, will fall back to one-shot posting");
    }
  }

  const ctx: DeliveryContext = {
    client, session, sessionInfo, claudeOptions,
    streamer, targetChannel, targetThread,
    alreadyDelivered: false,
    startTime: Date.now(),
    silentThinking,
  };

  const deliver = silentThinking
    ? buildDirectDeliverFn(ctx)
    : buildDeliverFn(ctx);

  try {
    const user = userInfo?.displayName ?? userInfo?.username ?? sessionInfo.userId;
    logger.info(
      `Calling Claude (user: ${user}, session: ${session.sessionId}, role: ${claudeOptions.role ?? "member"}, changesWorkflow: ${claudeOptions.changesWorkflowEnabled ?? false}${silentThinking ? ", silentThinking" : ""})`
    );
    const response = await askClaude(session, {
      ...claudeOptions,
      slackClient: client,
      deliver,
      onEvent: streamer?.handleEvent ?? (() => {}),
      abortController,
      userTimezone: userInfo?.tz,
    });

    if (response.cancelled) {
      await handleCancellation(ctx);
      return response;
    }

    if (response.success) {
      await handleSuccess(ctx, response);
    } else {
      await handleError(ctx, response);
    }

    return response;
  } catch (error) {
    await handleUnexpectedError(ctx, error);
    throw error;
  } finally {
    await streamer?.stop();
  }
}

// ============================================================
// DELIVERY HELPERS
// ============================================================

/**
 * Build the DeliverFn that Claude's submit_response tool calls.
 * Tries the streamer first, falls back to chat.postMessage.
 */
function buildDeliverFn(ctx: DeliveryContext): DeliverFn {
  return async (opts) => {
    if (ctx.alreadyDelivered) {
      return { ok: false as const, error: "Response already delivered" };
    }

    try {
      if (ctx.streamer && !ctx.streamer.hasFailed) {
        await ctx.streamer.stop({
          markdownText: opts.markdownText,
          ...(opts.blocks && { blocks: opts.blocks }),
        });

        if (!ctx.streamer.hasFailed) {
          ctx.alreadyDelivered = true;
          await sendResponseNotification(ctx);
          return { ok: true as const };
        }
        // Stop failed — fall through to chat.postMessage fallback
      }

      // Fallback: post via chat.postMessage
      await ctx.client.chat.postMessage({
        channel: ctx.targetChannel,
        thread_ts: ctx.targetThread,
        text: opts.markdownText,
        ...(opts.blocks && { blocks: opts.blocks }),
      });
      ctx.alreadyDelivered = true;
      return { ok: true as const };
    } catch (error) {
      logger.error("Delivery failed:", error);
      return { ok: false as const, error: toErrorMessage(error) };
    }
  };
}

/**
 * Build a DeliverFn that posts directly via chat.postMessage without thread_ts.
 * Used for silentThinking mode (e.g., cron jobs) where no streaming UX is needed.
 */
function buildDirectDeliverFn(ctx: DeliveryContext): DeliverFn {
  return async (opts) => {
    if (ctx.alreadyDelivered) {
      return { ok: false as const, error: "Response already delivered" };
    }

    try {
      const result = await ctx.client.chat.postMessage({
        channel: ctx.targetChannel,
        text: opts.markdownText,
        ...(opts.blocks && { blocks: opts.blocks }),
      });
      ctx.alreadyDelivered = true;
      if (result.ts) {
        await updateSession(ctx.session.sessionId, { responseTs: result.ts });
      }
      return { ok: true as const };
    } catch (error) {
      logger.error("Direct delivery failed:", error);
      return { ok: false as const, error: toErrorMessage(error) };
    }
  };
}

/**
 * Post a follow-up notification so the user gets a Slack ping.
 * Stream edits don't trigger notifications, so we send a short message.
 * Only sends if the response took longer than 60 seconds (quick answers don't need a ping).
 */
async function sendResponseNotification(ctx: DeliveryContext): Promise<void> {
  const elapsedMs = Date.now() - ctx.startTime;
  logger.debug(`Response notification check: elapsed ${Math.round(elapsedMs / 1000)}s (threshold: 60s)`);
  if (elapsedMs < 60_000) return;

  if (await getUserPreference(ctx.sessionInfo.userId, "notifyOnResponse")) {
    await ctx.client.chat.postMessage({
      channel: ctx.targetChannel,
      thread_ts: ctx.targetThread,
      text: "Response ready! Need anything else?",
    });
  }
}

/**
 * Deliver a message via streamer with chat.postMessage fallback.
 */
async function deliverViaStreamerOrFallback(
  ctx: DeliveryContext,
  text: string,
): Promise<void> {
  if (ctx.streamer) {
    await ctx.streamer.stop({ markdownText: text });
    if (!ctx.streamer.hasFailed) return;
  }
  await ctx.client.chat.postMessage({
    channel: ctx.targetChannel,
    ...(ctx.silentThinking ? {} : { thread_ts: ctx.targetThread }),
    text,
  });
}

/**
 * Handle a cancelled response: deliver the cancellation message if not already delivered.
 */
async function handleCancellation(ctx: DeliveryContext): Promise<void> {
  if (!ctx.alreadyDelivered) {
    await deliverViaStreamerOrFallback(ctx, "_Request cancelled._");
  }
}

/**
 * Handle a successful Claude response: persist state, deliver if needed, auto-execute actions.
 */
async function handleSuccess(ctx: DeliveryContext, response: ClaudeResponse): Promise<void> {
  await persistResponseState(ctx.session, response);

  if (!ctx.alreadyDelivered) {
    // submit_response was NOT called — deliver raw text via stream
    await deliverViaStreamerOrFallback(ctx, response.answer);
    if (ctx.streamer && !ctx.streamer.hasFailed) {
      await sendResponseNotification(ctx);
    }
  }

  await handleAutoExecuteActions({
    client: ctx.client,
    channelId: ctx.sessionInfo.channelId,
    threadTs: ctx.sessionInfo.threadTs,
    userId: ctx.sessionInfo.userId,
    response,
    sessionId: ctx.session.sessionId,
    role: ctx.claudeOptions.role ?? "member",
    dmChannel: ctx.sessionInfo.dmChannel,
    dmThreadTs: ctx.sessionInfo.dmThreadTs,
    triggerType: ctx.sessionInfo.triggerType,
  });
}

/**
 * Handle a failed Claude response: log error, post error UI, and optionally send DM report.
 */
async function handleError(ctx: DeliveryContext, response: ClaudeResponse): Promise<void> {
  const errorMessage = response.error || "Unknown error";
  const conversationTrace = response.conversationTrace || [];

  logger.error("Claude failed:", errorMessage);

  try {
    await addError(ctx.session.sessionId, errorMessage, conversationTrace);
  } catch (err) {
    logger.error("Failed to persist error to session:", err);
  }

  const isPlatformLimit = /usage limit|limit reached/i.test(errorMessage);
  const errorText = isPlatformLimit
    ? errorMessage
    : `Claude seems to have crashed (session: ${ctx.session.sessionId}), maybe try again?`;

  // For silentThinking, suppress channel error posting — caller handles errors
  if (ctx.silentThinking) {
    await sendErrorReportDM(ctx, errorMessage, conversationTrace);
    return;
  }

  // Post error via chat.postMessage (stream may already be stopped if submit_response
  // delivered before the SDK errored)
  await ctx.streamer?.stop();
  await ctx.client.chat.postMessage({
    channel: ctx.targetChannel,
    thread_ts: ctx.targetThread,
    blocks: asSlackBlocks(getErrorBlocksWithRetry(ctx.session.sessionId)),
    text: errorText,
  });

  await sendErrorReportDM(ctx, errorMessage, conversationTrace);
}

/**
 * Send an error analysis DM to the user if configured.
 */
async function sendErrorReportDM(
  ctx: DeliveryContext,
  errorMessage: string,
  conversationTrace: ClaudeResponse["conversationTrace"] & unknown[],
): Promise<void> {
  const config = getConfig();
  if (!config.slack.sendErrorsAsDM) return;

  try {
    const analysis = await analyzeError(errorMessage, conversationTrace);
    await sendErrorReport(ctx.client, ctx.sessionInfo.userId, {
      sessionId: ctx.session.sessionId,
      errorMessage,
      conversationTrace,
      analysis,
    });
  } catch (dmError) {
    logger.error("Failed to send error report DM:", dmError);
  }
}

/**
 * Handle unexpected errors: stop the stream and post a fallback message.
 */
async function handleUnexpectedError(ctx: DeliveryContext, error: unknown): Promise<void> {
  logger.error("Unhandled error in executeAndDeliver:", error);
  try {
    await deliverViaStreamerOrFallback(ctx, "Something went wrong processing this request.");
  } catch {
    // Last resort — stream is unrecoverable
  }
}

// ============================================================
// RESPONSE STATE PERSISTENCE
// ============================================================

/**
 * Persist the Claude response state to the session (answer, response payload, intents, tool history).
 */
async function persistResponseState(
  session: SessionContext,
  response: ClaudeResponse,
): Promise<void> {
  await setLastAnswer(session.sessionId, response.answer);

  const sessionUpdates: Partial<SessionContext> = {};
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
    await updateSession(session.sessionId, sessionUpdates);
  }
}

// ============================================================
// SHARED HELPERS
// ============================================================

/**
 * Post a response message to the user in the thread.
 * For DM-first sessions, posts to the DM thread (where the user interacts).
 * Used by resend.ts for re-posting existing responses.
 */
export async function postResponse(
  client: App["client"],
  sessionInfo: SessionInfo,
  options: { blocks?: SlackBlocks; text: string },
): Promise<void> {
  const channel = sessionInfo.dmChannel || sessionInfo.channelId;
  const threadTs = sessionInfo.dmThreadTs || sessionInfo.threadTs;

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    ...(options.blocks ? { blocks: options.blocks } : {}),
    text: options.text,
  });
}

/**
 * Build Claude options from session info (role + changes workflow).
 */
export function getHandlerClaudeOptions(
  sessionInfo: SessionInfo,
): Promise<AskClaudeOptions> {
  return getClaudeOptions(
    sessionInfo.userId,
    sessionInfo.triggerType ?? "directMessages",
  );
}
