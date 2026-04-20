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
import type { DeliverFn, ToolCallRecord } from "../../tools/types.js";
import { getErrorBlocksWithRetry, asSlackBlocks, type SlackBlocks } from "../blocks.js";
import { extractDisplayText } from "../blockText.js";
import type { Block } from "../blockSchema.js";
import {
  setLastAnswer,
  updateSession,
  addError,
  setAutoResponseActive,
  createSession,
} from "../../sessions.js";
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
import { resolveChannelLabel, slackLink } from "../logContext.js";
import { writeErrorReport } from "../../errorReports.js";

export interface HandlerResponseDeps {
  askClaude: typeof askClaude;
  analyzeError: typeof analyzeError;
  setLastAnswer: typeof setLastAnswer;
  updateSession: typeof updateSession;
  addError: typeof addError;
  setAutoResponseActive: typeof setAutoResponseActive;
  /** Optional: when present, top-level posts create a follow-up session tied to the new thread. */
  createSession?: typeof createSession;
  getErrorBlocksWithRetry: typeof getErrorBlocksWithRetry;
  asSlackBlocks: typeof asSlackBlocks;
  sendErrorReport: typeof sendErrorReport;
  getConfig: typeof getConfig;
  getClaudeOptions: typeof getClaudeOptions;
  handleAutoExecuteActions: typeof handleAutoExecuteActions;
  createStreamer: (opts: ConstructorParameters<typeof SlackStreamer>[0]) => SlackStreamer;
  getUserPreference: typeof getUserPreference;
  writeErrorReport: typeof writeErrorReport;
  toErrorMessage: typeof toErrorMessage;
  getUserInfo: typeof getUserInfo;
  resolveChannelLabel: typeof resolveChannelLabel;
  slackLink: typeof slackLink;
}

export const defaultHandlerResponseDeps: HandlerResponseDeps = {
  askClaude,
  analyzeError,
  setLastAnswer,
  updateSession,
  addError,
  setAutoResponseActive,
  createSession,
  getErrorBlocksWithRetry,
  asSlackBlocks,
  sendErrorReport,
  getConfig,
  getClaudeOptions,
  handleAutoExecuteActions,
  createStreamer: (opts) => new SlackStreamer(opts),
  getUserPreference,
  writeErrorReport,
  toErrorMessage,
  getUserInfo,
  resolveChannelLabel,
  slackLink,
};

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
  deps?: HandlerResponseDeps;
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
  deps: HandlerResponseDeps;
}

/**
 * Single code path for all Claude → Slack delivery.
 * Trigger-agnostic: reads sessionInfo to derive target channel/thread.
 * Handles streaming, delivery via submit_response, error reporting, and auto-execute.
 */
export async function executeAndDeliver(params: ExecuteAndDeliverParams): Promise<ClaudeResponse> {
  const {
    client,
    session,
    sessionInfo,
    claudeOptions,
    abortController,
    silentThinking = false,
    deps = defaultHandlerResponseDeps,
  } = params;

  // Derive target from sessionInfo (DM-aware)
  const targetChannel = sessionInfo.dmChannel ?? sessionInfo.channelId;
  const targetThread = sessionInfo.dmThreadTs ?? sessionInfo.threadTs;

  const userInfo = await deps.getUserInfo(client, sessionInfo.userId);

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

    streamer = deps.createStreamer({
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
    client,
    session,
    sessionInfo,
    claudeOptions,
    streamer,
    targetChannel,
    targetThread,
    alreadyDelivered: false,
    startTime: Date.now(),
    silentThinking,
    deps,
  };

  const deliver = silentThinking ? buildDirectDeliverFn(ctx) : buildDeliverFn(ctx);

  try {
    const user = userInfo?.displayName ?? userInfo?.username ?? sessionInfo.userId;
    const channelLabel = await deps.resolveChannelLabel(client, sessionInfo.channelId);
    const link = await deps.slackLink(client, sessionInfo.channelId, sessionInfo.threadTs);
    const viewingSuffix = session.assistantCurrentChannelId
      ? `, viewing ${await deps.resolveChannelLabel(client, session.assistantCurrentChannelId)}`
      : "";
    logger.info(
      `Calling Claude for ${user} in ${channelLabel} (role: ${claudeOptions.role ?? "member"}, session: ${session.sessionId}${viewingSuffix}${silentThinking ? ", silentThinking" : ""})${link}`,
    );
    const liveToolHistory: ToolCallRecord[] = [];
    const response = await deps.askClaude(session, {
      ...claudeOptions,
      slackClient: client,
      deliver,
      onEvent: streamer?.handleEvent ?? (() => {}),
      onToolCall: async (record) => {
        liveToolHistory.push(record);
        try {
          await deps.updateSession(session.sessionId, { toolCallHistory: [...liveToolHistory] });
        } catch (err) {
          logger.warn(`Failed to persist live tool call to session: ${toErrorMessage(err)}`);
        }
      },
      abortController,
      userTimezone: userInfo?.tz,
    });

    if (response.cancelled) {
      await handleCancellation(ctx);
      return response;
    }

    if (response.skipped) {
      await handleSkip(ctx, response);
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
 * Add emoji reactions to a posted message. Failures are logged as warnings
 * but never affect the delivery result. already_reacted is silently ignored.
 */
async function addDeliveryReactions(
  client: App["client"],
  channel: string,
  timestamp: string,
  reactions: string[],
): Promise<void> {
  for (const emoji of reactions) {
    try {
      await client.reactions.add({ channel, timestamp, name: emoji });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already_reacted")) {
        logger.warn(`Failed to add reaction :${emoji}: — ${msg}`);
      }
    }
  }
}

/**
 * Extract a plain-text notification string from rendered blocks.
 * Used as the `text:` parameter in `chat.postMessage` — Slack displays it in
 * push notifications and as a screen-reader fallback (never shown inline when
 * blocks are present). Truncated to 500 chars to keep notifications short.
 */
function notificationText(blocks: SlackBlocks): string {
  const text = extractDisplayText(blocks as Block[]);
  return text.length > 500 ? text.slice(0, 497) + "..." : text;
}

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
      let ts: string | undefined;

      // Top-level delivery: streamer is thread-bound, so delete its message and post fresh
      // to the channel with no thread_ts.
      if (opts.postTopLevel) {
        if (ctx.streamer) {
          await ctx.streamer.stop();
          const streamerTs = ctx.streamer.getMessageTs();
          if (streamerTs) {
            try {
              await ctx.client.chat.delete({
                channel: ctx.targetChannel,
                ts: streamerTs,
              });
            } catch (err) {
              logger.warn("Failed to delete streamer message before top-level post:", err);
            }
          }
        }
        const fallbackText = notificationText(opts.blocks);
        const result = await ctx.client.chat.postMessage({
          channel: ctx.targetChannel,
          text: fallbackText,
          blocks: opts.blocks,
        });
        ts = result.ts;
        ctx.alreadyDelivered = true;
        // A top-level post is a new conversational context — replies to it belong to a
        // thread Clack just created, not the parent thread that triggered the bot. Create
        // a fresh session for that new thread so future replies get their own pre-analysis,
        // their own disengage state, and their own history, while inheriting "similar
        // context" from the parent (channel, channelName, auto-respond rule's extraContext).
        // Silently log on failure — losing the follow-up session is a UX regression, not a
        // correctness failure, so delivery should still succeed.
        if (ts && ctx.deps.createSession) {
          try {
            await ctx.deps.createSession({
              channelId: ctx.targetChannel,
              messageTs: ts,
              threadTs: ts,
              userId: ctx.session.userId,
              originalQuestion: fallbackText.slice(0, 500),
              triggerType: "autoRespond",
              additionalSystemPrompt: ctx.session.additionalSystemPrompt,
              channelName: ctx.session.channelName,
              username: ctx.session.username,
              displayName: ctx.session.displayName,
            });
          } catch (err) {
            logger.warn("Failed to create follow-up session for top-level post:", err);
          }
        }
        if (opts.reactions?.length && ts) {
          await addDeliveryReactions(ctx.client, ctx.targetChannel, ts, opts.reactions);
        }
        return { ok: true as const, ts };
      }

      if (ctx.streamer && !ctx.streamer.hasFailed) {
        await ctx.streamer.stop({ blocks: opts.blocks });

        if (!ctx.streamer.hasFailed) {
          ts = ctx.streamer.getMessageTs();
          ctx.alreadyDelivered = true;
          await sendResponseNotification(ctx);
          if (opts.reactions?.length && ts) {
            await addDeliveryReactions(ctx.client, ctx.targetChannel, ts, opts.reactions);
          }
          return { ok: true as const, ts };
        }
        // Stop failed — fall through to chat.postMessage fallback
      }

      // Fallback: post via chat.postMessage
      const result = await ctx.client.chat.postMessage({
        channel: ctx.targetChannel,
        thread_ts: ctx.targetThread,
        text: notificationText(opts.blocks),
        blocks: opts.blocks,
      });
      ts = result.ts;
      ctx.alreadyDelivered = true;
      if (opts.reactions?.length && ts) {
        await addDeliveryReactions(ctx.client, ctx.targetChannel, ts, opts.reactions);
      }
      return { ok: true as const, ts };
    } catch (error) {
      logger.error("Delivery failed:", error);
      return { ok: false as const, error: ctx.deps.toErrorMessage(error) };
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
        text: notificationText(opts.blocks),
        blocks: opts.blocks,
      });
      ctx.alreadyDelivered = true;
      const ts = result.ts;
      if (ts) {
        await ctx.deps.updateSession(ctx.session.sessionId, { responseTs: ts });
      }
      if (opts.reactions?.length && ts) {
        await addDeliveryReactions(ctx.client, ctx.targetChannel, ts, opts.reactions);
      }
      return { ok: true as const, ts };
    } catch (error) {
      logger.error("Direct delivery failed:", error);
      return { ok: false as const, error: ctx.deps.toErrorMessage(error) };
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
  logger.debug(
    `Response notification check: elapsed ${Math.round(elapsedMs / 1000)}s (threshold: 60s)`,
  );
  if (elapsedMs < 60_000) return;

  if (await ctx.deps.getUserPreference(ctx.sessionInfo.userId, "notifyOnResponse")) {
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
async function deliverViaStreamerOrFallback(ctx: DeliveryContext, text: string): Promise<void> {
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
 * Handle a skipped response: delete the streamer message so no trace remains.
 * Skips session persistence and auto-execute.
 */
async function handleSkip(ctx: DeliveryContext, response: ClaudeResponse): Promise<void> {
  // Stop the streamer first so the finally block's stop() becomes a no-op
  // (stop checks this.stopped internally). Must happen before chat.delete
  // to avoid the finally block attempting to finalize a deleted message.
  await ctx.streamer?.stop();

  const messageTs = ctx.streamer?.getMessageTs();
  if (messageTs) {
    try {
      await ctx.client.chat.delete({
        channel: ctx.targetChannel,
        ts: messageTs,
      });
    } catch (error) {
      logger.warn("Failed to delete streamer message after skip:", error);
    }
  }

  // Disengage: permanently stop tracking this thread for auto-respond
  if (response.disengaged) {
    try {
      await ctx.deps.setAutoResponseActive(ctx.session.sessionId, false);
    } catch (err) {
      logger.error("Failed to persist disengage state on skip:", err);
    }
  }
}

/**
 * Handle a successful Claude response: persist state, deliver if needed, auto-execute actions.
 */
async function handleSuccess(ctx: DeliveryContext, response: ClaudeResponse): Promise<void> {
  await persistResponseState(ctx, ctx.session, response);

  if (!ctx.alreadyDelivered) {
    // submit_response was NOT called — deliver raw text via stream
    await deliverViaStreamerOrFallback(ctx, response.answer);
    if (ctx.streamer && !ctx.streamer.hasFailed) {
      await sendResponseNotification(ctx);
    }
    // When the turn ends without submit_response but actionable intents are staged,
    // those intents are orphans: handleAutoExecuteActions only fires actions from a
    // submit_response payload. Warn explicitly instead of silently dropping them so
    // the user knows a retry is needed.
    await warnOnOrphanStagedIntents(ctx, response);
  }

  // Disengage: permanently stop tracking this thread for auto-respond.
  // Only reached after successful delivery (delivery_failed returns before buildSuccessResponse),
  // so a failed delivery never persists disengagement. Swallow any persistence error
  // so handleAutoExecuteActions still runs — losing the disengage state is less bad
  // than dropping the user's staged intents.
  if (response.disengaged) {
    try {
      await ctx.deps.setAutoResponseActive(ctx.session.sessionId, false);
    } catch (err) {
      logger.error("Failed to persist disengage state on success:", err);
    }
  }

  await ctx.deps.handleAutoExecuteActions({
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

const ORPHANABLE_INTENT_TYPES = new Set(["change", "update", "config_update"]);

async function warnOnOrphanStagedIntents(
  ctx: DeliveryContext,
  response: ClaudeResponse,
): Promise<void> {
  const intents = response.stagedIntents;
  if (!intents) return;
  const orphanTypes = Object.values(intents)
    .map((i) => i.type)
    .filter((t) => ORPHANABLE_INTENT_TYPES.has(t));
  if (orphanTypes.length === 0) return;

  const list = Array.from(new Set(orphanTypes)).join(", ");
  try {
    await ctx.client.chat.postMessage({
      channel: ctx.sessionInfo.channelId,
      thread_ts: ctx.sessionInfo.threadTs,
      text: `I prepared a \`${list}\` action but didn't deliver it. Nothing was actually triggered. Please ask again to retry.`,
    });
  } catch (err) {
    logger.error("Failed to post orphan-intent warning:", err);
  }
}

/**
 * Handle a failed Claude response: log error, post error UI, and optionally send DM report.
 */
async function handleError(ctx: DeliveryContext, response: ClaudeResponse): Promise<void> {
  const errorMessage = response.error || "Unknown error";
  const conversationTrace = response.conversationTrace || [];

  logger.error("Claude failed:", errorMessage);

  try {
    await ctx.deps.addError(ctx.session.sessionId, errorMessage, conversationTrace);
  } catch (err) {
    logger.error("Failed to persist error to session:", err);
  }

  // Preserve the recorder history on the session even on failure — otherwise silent/scheduled
  // runs lose the only record of what tools actually returned. The error-report file captures
  // this too, but the session file is the natural first place to look.
  if (response.toolCallHistory && response.toolCallHistory.length > 0) {
    try {
      await ctx.deps.updateSession(ctx.session.sessionId, {
        toolCallHistory: response.toolCallHistory,
      });
    } catch (err) {
      logger.error("Failed to persist toolCallHistory to session:", err);
    }
  }

  const isPlatformLimit = /usage limit|limit reached/i.test(errorMessage);
  const errorText = isPlatformLimit
    ? errorMessage
    : `Claude seems to have crashed (session: ${ctx.session.sessionId}), maybe try again?`;

  // For silentThinking, suppress channel error posting — caller handles errors
  if (ctx.silentThinking) {
    await sendErrorReportDM(
      ctx,
      errorMessage,
      conversationTrace,
      response.stderrOutput,
      response.toolCallHistory,
    );
    return;
  }

  // Post error via chat.postMessage (stream may already be stopped if submit_response
  // delivered before the SDK errored)
  await ctx.streamer?.stop();
  await ctx.client.chat.postMessage({
    channel: ctx.targetChannel,
    thread_ts: ctx.targetThread,
    blocks: ctx.deps.asSlackBlocks(ctx.deps.getErrorBlocksWithRetry(ctx.session.sessionId)),
    text: errorText,
  });

  await sendErrorReportDM(
    ctx,
    errorMessage,
    conversationTrace,
    response.stderrOutput,
    response.toolCallHistory,
  );
}

/**
 * Send an error analysis DM to the user and persist a full report to disk.
 */
async function sendErrorReportDM(
  ctx: DeliveryContext,
  errorMessage: string,
  conversationTrace: ClaudeResponse["conversationTrace"] & unknown[],
  stderrOutput?: string,
  toolCallHistory?: ClaudeResponse["toolCallHistory"],
): Promise<void> {
  try {
    const analysis = await ctx.deps.analyzeError(errorMessage, conversationTrace);

    // Always persist to disk for later investigation
    await ctx.deps.writeErrorReport({
      sessionId: ctx.session.sessionId,
      errorMessage,
      conversationTrace,
      toolCallHistory,
      stderrOutput,
      analysis,
      timestamp: Date.now(),
    });

    // DM is optional
    const config = ctx.deps.getConfig();
    if (!config.slack.sendErrorsAsDM) return;

    await ctx.deps.sendErrorReport(ctx.client, ctx.sessionInfo.userId, {
      sessionId: ctx.session.sessionId,
      errorMessage,
      conversationTrace,
      stderrOutput,
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
  ctx: DeliveryContext,
  session: SessionContext,
  response: ClaudeResponse,
): Promise<void> {
  await ctx.deps.setLastAnswer(session.sessionId, response.answer);

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
    await ctx.deps.updateSession(session.sessionId, sessionUpdates);
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
  deps: HandlerResponseDeps = defaultHandlerResponseDeps,
): Promise<AskClaudeOptions> {
  return deps.getClaudeOptions(sessionInfo.userId, sessionInfo.triggerType ?? "directMessages");
}
