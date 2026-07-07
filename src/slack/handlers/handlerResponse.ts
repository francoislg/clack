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
import type { DeliverFn, DeliveryControl, ToolCallRecord } from "../../tools/types.js";
import type { DeliveryHandler } from "./delivery/types.js";
import { StreamingDelivery } from "./delivery/streamingDelivery.js";
import { SilentDelivery } from "./delivery/silentDelivery.js";
import { NullDelivery } from "./delivery/nullDelivery.js";
import {
  getErrorBlocksWithRetry,
  getUsageLimitBlocks,
  usageLimitText,
  asSlackBlocks,
  type SlackBlocks,
} from "../blocks.js";
import { t } from "../../i18n/t.js";
import {
  updateSession,
  addError,
  setAttentionLevel,
  setDeliveryMode,
  createSession,
  registerThreadSession,
  appendAssistantMessage,
  appendStagedIntents,
} from "../../sessions.js";
import { appendSessionToEphemeralRule } from "../../ephemeralRules.js";
import type { SessionAssistantMessage, DeliveryMode } from "../../sessions.js";
import { askClaude } from "../../claude/index.js";
import { analyzeError } from "../../claude/utilities.js";
import { sendErrorReport } from "../messagesApi.js";
import { getConfig } from "../../config.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { handleAutoExecuteActions } from "./autoExecute.js";
import { addDeliveryReactions } from "../messageReactions.js";
import { notificationText } from "../messagePoster.js";
import { unfurlOptions } from "../unfurlOptions.js";
import { SlackStreamer } from "../../streaming/slackStreamer.js";
import { isChannellessChannelId } from "../../channelless.js";
import { getUserInfo } from "../userCache.js";
import { getUserPreference } from "../../userPreferences.js";
import { logger } from "../../logger.js";
import { resolveChannelLabel, slackLink } from "../logContext.js";
import { writeErrorReport } from "../../errorReports.js";
import { getOwnerUserId, sendOwnerDm } from "../ownerDm.js";

export interface HandlerResponseDeps {
  askClaude: typeof askClaude;
  analyzeError: typeof analyzeError;
  /** Optional for tests that don't exercise the unified conversation log yet.
   *  Production code always receives the default via `defaultHandlerResponseDeps`. */
  appendAssistantMessage?: typeof appendAssistantMessage;
  updateSession: typeof updateSession;
  appendStagedIntents: typeof appendStagedIntents;
  addError: typeof addError;
  setAttentionLevel: typeof setAttentionLevel;
  setDeliveryMode: typeof setDeliveryMode;
  /** Optional: when present, top-level posts create a follow-up session tied to the new thread. */
  createSession?: typeof createSession;
  /** Seeds an engaged session on a thread (channelReply threaded handoff). */
  registerThreadSession: typeof registerThreadSession;
  /** Records a session joining a channel conversation's ledger (channelReply turns). */
  appendSessionToEphemeralRule: typeof appendSessionToEphemeralRule;
  getErrorBlocksWithRetry: typeof getErrorBlocksWithRetry;
  getUsageLimitBlocks: typeof getUsageLimitBlocks;
  asSlackBlocks: typeof asSlackBlocks;
  sendErrorReport: typeof sendErrorReport;
  getConfig: typeof getConfig;
  getClaudeOptions: typeof getClaudeOptions;
  handleAutoExecuteActions: typeof handleAutoExecuteActions;
  createStreamer: (opts: ConstructorParameters<typeof SlackStreamer>[0]) => SlackStreamer;
  getUserPreference: typeof getUserPreference;
  writeErrorReport: typeof writeErrorReport;
  getOwnerUserId: typeof getOwnerUserId;
  sendOwnerDm: typeof sendOwnerDm;
  toErrorMessage: typeof toErrorMessage;
  getUserInfo: typeof getUserInfo;
  resolveChannelLabel: typeof resolveChannelLabel;
  slackLink: typeof slackLink;
}

export const defaultHandlerResponseDeps: HandlerResponseDeps = {
  askClaude,
  analyzeError,
  appendAssistantMessage,
  updateSession,
  appendStagedIntents,
  addError,
  setAttentionLevel,
  setDeliveryMode,
  createSession,
  registerThreadSession,
  appendSessionToEphemeralRule,
  getErrorBlocksWithRetry,
  getUsageLimitBlocks,
  asSlackBlocks,
  sendErrorReport,
  getConfig,
  getClaudeOptions,
  handleAutoExecuteActions,
  createStreamer: (opts) => new SlackStreamer(opts),
  getUserPreference,
  writeErrorReport,
  getOwnerUserId,
  sendOwnerDm,
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
  /**
   * When true, suppress ALL Slack output for this turn — the primary delivery posts nothing
   * (NullDelivery) and auto-executed changes run with `report_status`/status posts suppressed.
   * GitHub-side effects still happen. See the `silent-change-execution` capability.
   */
  silent?: boolean;
  /** Pre-analysis verdict from the autoRespond gate for THIS turn. Stamped onto the appended
   *  `SessionAssistantMessage` so the per-turn decision trail is preserved on disk. */
  preAnalysis?: string;
  deps?: HandlerResponseDeps;
}

/** Internal context shared by executeAndDeliver and its helpers. `current` is the active
 *  delivery handler — mutable so a mid-run `setDelivery` swap is visible to every closure that
 *  reads `ctx.current` (the `onEvent` forwarder, the deliver fn, and the handle* helpers). */
interface DeliveryContext {
  client: App["client"];
  session: SessionContext;
  sessionInfo: SessionInfo;
  claudeOptions: AskClaudeOptions;
  current: DeliveryHandler;
  targetChannel: string;
  targetThread: string;
  alreadyDelivered: boolean;
  startTime: number;
  silentThinking: boolean;
  /** When true, suppress all Slack output (primary delivery + auto-executed change posts). */
  silent: boolean;
  preAnalysis?: string;
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
    silent = false,
    preAnalysis,
    deps = defaultHandlerResponseDeps,
  } = params;

  // Derive target from sessionInfo (DM-aware)
  const targetChannel = sessionInfo.dmChannel ?? sessionInfo.channelId;
  const targetThread = sessionInfo.dmThreadTs ?? sessionInfo.threadTs;

  const userInfo = await deps.getUserInfo(client, sessionInfo.userId);

  // Construct (not start) the streamer lazily, so its bot-fallback auth.test runs only when a
  // streaming surface is actually opened — at turn start for streamer mode, or at a mid-run
  // switch into streamer mode. Slack's streaming API requires a human recipient, so fall back
  // to the bot's own user id when the session user is a bot (e.g. a Sentry-triggered run).
  const makeStreamer = async (): Promise<SlackStreamer> => {
    let streamUserId = sessionInfo.userId;
    if (userInfo?.isBot || sessionInfo.userId === "auto-respond") {
      const authResult = await client.auth.test();
      streamUserId = authResult.user_id ?? streamUserId;
    }
    return deps.createStreamer({
      client,
      channel: targetChannel,
      threadTs: targetThread,
      userId: streamUserId,
    });
  };

  // A `silent` run posts nothing at all (NullDelivery). Otherwise `silentThinking` picks the
  // no-progress-card SilentDelivery, and the default is the live StreamingDelivery.
  const handlerFor = (thinkingSilent: boolean): DeliveryHandler =>
    silent
      ? new NullDelivery()
      : thinkingSilent
        ? new SilentDelivery({
            client,
            targetChannel,
            targetThread,
            recordResponseTs: async (ts) => {
              await deps.updateSession(session.sessionId, { responseTs: ts });
            },
          })
        : new StreamingDelivery({ client, targetChannel, targetThread, makeStreamer });

  const ctx: DeliveryContext = {
    client,
    session,
    sessionInfo,
    claudeOptions,
    current: handlerFor(silentThinking),
    targetChannel,
    targetThread,
    alreadyDelivered: false,
    startTime: Date.now(),
    silentThinking,
    silent,
    preAnalysis,
    deps,
  };

  await ctx.current.windUp();

  // Swap the active handler mid-run: tear down the old surface (discarding it), install the
  // new one, open it. The `onEvent`/deliver closures read `ctx.current`, so the swap is live.
  const setDelivery = async (next: DeliveryHandler): Promise<void> => {
    await ctx.current.windDown({ discard: true });
    ctx.current = next;
    await ctx.current.windUp();
  };

  let currentMode: DeliveryMode = silentThinking ? "invisible" : "streamer";
  const deliveryControl: DeliveryControl = {
    switchTo: async (mode) => {
      if (ctx.alreadyDelivered) return; // this turn's surface is already finalized
      if (mode === currentMode) return; // idempotent
      await setDelivery(handlerFor(mode === "invisible"));
      currentMode = mode;
      try {
        await deps.setDeliveryMode(session.sessionId, mode);
      } catch (err) {
        logger.error("Failed to persist delivery mode on switch:", err);
      }
    },
  };

  const deliver = buildDeliverFn(ctx);

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
    const handle = await deps.askClaude(session, {
      ...claudeOptions,
      slackClient: client,
      deliver,
      // Only where a real delivery surface exists. A channelless run posts to a synthetic
      // channel, so there is nothing to switch — omit the control (and thus the tool).
      ...(!isChannellessChannelId(targetChannel) && { deliveryControl }),
      // Stable forwarder: reads `ctx.current` live so a handler installed mid-run (via a
      // `switch_delivery_context` swap) starts receiving events without rebinding.
      onEvent: (event) => ctx.current.handleEvent(event),
      onToolCall: (record) => {
        liveToolHistory.push(record);
      },
      abortController,
      userTimezone: userInfo?.tz,
    });
    const response = await handle.futureResponse;

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
    // Safety net: ensure the surface is closed (frozen, not discarded) even on paths that
    // didn't deliver. Idempotent — a no-op when the handler already finalized.
    await ctx.current.windDown();
  }
}

// ============================================================
// DELIVERY HELPERS
// ============================================================

/** Fire-and-forget reaction adding (never blocks delivery). Shared by every deliver branch. */
function applyDeliveryReactions(
  ctx: DeliveryContext,
  ts: string | undefined,
  reactions?: string[],
) {
  if (reactions?.length && ts) {
    addDeliveryReactions(ctx.client, ctx.targetChannel, ts, reactions).catch((err) =>
      logger.warn(`addDeliveryReactions threw: ${err}`),
    );
  }
}

/** channelReply only: record a session joining the channel conversation's ledger. Best-effort. */
async function appendToConversationLedger(ctx: DeliveryContext, sessionId: string): Promise<void> {
  if (ctx.sessionInfo.triggerType !== "channelReply") return;
  try {
    await ctx.deps.appendSessionToEphemeralRule(ctx.targetChannel, sessionId);
  } catch (err) {
    logger.warn("Failed to append session to channel conversation ledger:", err);
  }
}

/**
 * channelReply threaded handoff: the primary delivery landed as a reply in the thread under
 * the user's channel message, but the turn ran on the resumed ANCHOR session — no session is
 * indexed for that thread. Seed an engaged thread session (owned by the normal thread
 * auto-respond path from here on) and record it in the conversation ledger. Best-effort.
 */
async function seedChannelReplyThreadHandoff(ctx: DeliveryContext): Promise<void> {
  if (ctx.sessionInfo.triggerType !== "channelReply" || !ctx.targetThread) return;
  try {
    const seeded = await ctx.deps.registerThreadSession(ctx.targetChannel, ctx.targetThread, {
      attentionLevel: "medium",
      ...(ctx.session.additionalSystemPrompt && {
        creationContext: ctx.session.additionalSystemPrompt,
      }),
    });
    if (seeded) await appendToConversationLedger(ctx, seeded.sessionId);
  } catch (err) {
    logger.warn("Failed to seed thread handoff session for channel reply:", err);
  }
}

/**
 * Build the single DeliverFn that Claude's submit_response tool calls. The active delivery
 * handler (`ctx.current`) owns the primary landing (streaming finalizes its card in place;
 * silent posts directly); this function keeps the mode-agnostic concerns — the follower /
 * already-delivered guards, the top-level repost, reactions, and the response-ping decision.
 */
function buildDeliverFn(ctx: DeliveryContext): DeliverFn {
  return async (opts) => {
    // A silent run posts nothing — every branch below (primary, follower, top-level) would
    // hit Slack directly, so short-circuit here. The submit_response call still "succeeds",
    // so any staged change action proceeds to auto-execute (silently).
    if (ctx.silent) {
      ctx.alreadyDelivered = true;
      return { ok: true as const, ts: undefined };
    }

    // Follower delivery (multi-message batch): bypass the `alreadyDelivered` guard for thread
    // replies (`threadTs`) and extra top-level messages (`postTopLevel`). A plain post — the
    // primary already consumed the surface. Mode-agnostic.
    if (ctx.alreadyDelivered && (opts.threadTs || opts.postTopLevel)) {
      try {
        const result = await ctx.client.chat.postMessage({
          channel: ctx.targetChannel,
          ...(opts.threadTs && { thread_ts: opts.threadTs }),
          text: notificationText(opts.blocks),
          blocks: opts.blocks,
          ...unfurlOptions(opts.suppressUnfurls),
        });
        applyDeliveryReactions(ctx, result.ts, opts.reactions);
        return { ok: true as const, ts: result.ts };
      } catch (error) {
        logger.error("Follower delivery failed:", error);
        return { ok: false as const, error: ctx.deps.toErrorMessage(error) };
      }
    }

    if (ctx.alreadyDelivered) {
      return { ok: false as const, error: "Response already delivered" };
    }

    try {
      // Top-level delivery: the active surface is thread-bound, so tear it down (discarding
      // any messages it opened) and post fresh to the channel with no thread_ts. A top-level
      // post is a new conversational context, so seed a follow-up session for replies to it.
      if (opts.postTopLevel) {
        await ctx.current.windDown({ discard: true });
        const fallbackText = notificationText(opts.blocks);
        const result = await ctx.client.chat.postMessage({
          channel: ctx.targetChannel,
          text: fallbackText,
          blocks: opts.blocks,
          ...unfurlOptions(opts.suppressUnfurls),
        });
        const ts = result.ts;
        ctx.alreadyDelivered = true;
        // Future replies belong to a thread Clack just created, not the parent that triggered
        // the bot. Inherit "similar context" (channel, channelName, extraContext) from the
        // parent. Log on failure — losing the follow-up session is a UX regression, not a
        // correctness failure, so delivery should still succeed.
        if (ts && ctx.deps.createSession) {
          try {
            const followUp = await ctx.deps.createSession({
              channelId: ctx.targetChannel,
              messageTs: ts,
              threadTs: ts,
              userId: ctx.session.userId,
              trigger: {
                type: "autoRespond",
                userId: ctx.session.userId,
                messageTs: ts,
                messageText: fallbackText.slice(0, 500),
              },
              additionalSystemPrompt: ctx.session.additionalSystemPrompt,
              channelName: ctx.session.channelName,
              username: ctx.session.username,
              displayName: ctx.session.displayName,
            });
            await appendToConversationLedger(ctx, followUp.sessionId);
          } catch (err) {
            logger.warn("Failed to create follow-up session for top-level post:", err);
          }
        }
        applyDeliveryReactions(ctx, ts, opts.reactions);
        return { ok: true as const, ts };
      }

      // Primary delivery via the active handler. It reports whether its delivery already
      // notified the user (a real post does; a streaming in-place edit does not).
      const res = await ctx.current.deliver({
        blocks: opts.blocks,
        suppressUnfurls: opts.suppressUnfurls,
      });
      if (!res.ok) return res;
      ctx.alreadyDelivered = true;
      if (!res.notified) await sendResponseNotification(ctx);
      applyDeliveryReactions(ctx, res.ts, opts.reactions);
      await seedChannelReplyThreadHandoff(ctx);
      return { ok: true as const, ts: res.ts };
    } catch (error) {
      logger.error("Delivery failed:", error);
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
      text: t("response.ready_followup"),
    });
  }
}

/**
 * Deliver a raw-text answer (a turn that ended without submit_response) via the active handler,
 * pinging only when the handler's delivery did not notify on its own.
 */
async function deliverViaStreamerOrFallback(ctx: DeliveryContext, text: string): Promise<void> {
  const res = await ctx.current.deliver({ markdownText: text });
  if (res.ok && !res.notified) {
    await sendResponseNotification(ctx);
  }
}

/**
 * Handle a cancelled response: delete the streamer message so the thread shows
 * no trace of the cancelled run. If a message was already delivered (rare — the
 * streamer has committed a partial reply), leave it alone.
 */
async function handleCancellation(ctx: DeliveryContext): Promise<void> {
  if (ctx.alreadyDelivered) return;
  // Discard the surface so the thread shows no trace of the cancelled run.
  await ctx.current.windDown({ discard: true });
}

/**
 * Handle a skipped response: delete the streamer message so no trace remains.
 * Skips session persistence and auto-execute.
 */
async function handleSkip(ctx: DeliveryContext, response: ClaudeResponse): Promise<void> {
  // Discard the surface so no trace remains. windDown stops first, so the finally net's
  // windDown becomes a no-op (the streamer checks its own stopped state internally).
  await ctx.current.windDown({ discard: true });

  // unified-conversation-log: persist the skipped turn in a single updateSession
  // call together with the disengage flag (per skip-response spec requirement:
  // both updates must land atomically). No legacy fields are written on skip.
  try {
    const skippedMessage: SessionAssistantMessage = {
      role: "assistant",
      ts: Date.now(),
      skipped: true,
    };
    if (response.attentionLevel === "off") skippedMessage.disengaged = true;
    if (response.toolCallHistory && response.toolCallHistory.length > 0) {
      skippedMessage.toolCalls = response.toolCallHistory;
    }
    if (ctx.preAnalysis) skippedMessage.preAnalysis = ctx.preAnalysis;
    const existing = ctx.session.messages ?? [];
    const updates: Partial<SessionContext> = {
      messages: [...existing, skippedMessage],
    };
    if (response.attentionLevel) updates.attentionLevel = response.attentionLevel;
    if (response.deliveryMode) updates.deliveryMode = response.deliveryMode;
    await ctx.deps.updateSession(ctx.session.sessionId, updates);
  } catch (err) {
    logger.error("Failed to persist skipped turn to session:", err);
  }

  // A skipped turn can still escalate — the channelless-cron path declines the user message
  // (skip_response) yet sets escalate_to_owner, which is exactly where a silent failure hurts most.
  await maybeEscalateToOwner(ctx, response);
}

/**
 * Handle a successful Claude response: persist state, deliver if needed, auto-execute actions.
 */
async function handleSuccess(ctx: DeliveryContext, response: ClaudeResponse): Promise<void> {
  await persistResponseState(ctx, ctx.session, response);

  // Channelless runs (e.g. plugin crons) have NO primary destination — the synthetic
  // `channelless:<jobId>` target isn't a real channel. All delivery is via `post_to`
  // auto-execute below. A post-to-only success leaves `alreadyDelivered` false (no primary
  // deliver call), so without this guard we'd try to post the raw answer to the sentinel
  // channel and crash the whole job with channel_not_found.
  if (!ctx.alreadyDelivered && !isChannellessChannelId(ctx.targetChannel)) {
    // submit_response was NOT called — deliver raw text via stream
    await deliverViaStreamerOrFallback(ctx, response.answer);
    // When the turn ends without submit_response but actionable intents are staged,
    // those intents are orphans: handleAutoExecuteActions only fires actions from a
    // submit_response payload. Warn explicitly instead of silently dropping them so
    // the user knows a retry is needed.
    await warnOnOrphanStagedIntents(ctx, response);
  }

  // Apply any attention-level adjustment (raise, lower, or `"off"` to disengage) Claude set
  // this turn. Only reached after successful delivery (delivery_failed returns before
  // buildSuccessResponse), so a failed delivery never persists a level change. Swallow any
  // persistence error so handleAutoExecuteActions still runs — losing the level update is
  // less bad than dropping the user's staged intents.
  if (response.attentionLevel) {
    try {
      await ctx.deps.setAttentionLevel(ctx.session.sessionId, response.attentionLevel);
    } catch (err) {
      logger.error("Failed to persist attention level on success:", err);
    }
  }

  // Persist a delivery-mode switch the same way as attention level. Takes effect on the
  // thread's next turn — this turn's streaming UX was fixed before Claude ran.
  if (response.deliveryMode) {
    try {
      await ctx.deps.setDeliveryMode(ctx.session.sessionId, response.deliveryMode);
    } catch (err) {
      logger.error("Failed to persist delivery mode on success:", err);
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
    silent: ctx.silent,
  });

  await maybeEscalateToOwner(ctx, response);
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

  // unified-conversation-log: also record this turn's failure as a per-turn assistant
  // message so the conversation log reflects what happened. Legacy `errors[]` write above
  // remains during the transition — both lift in §9.
  try {
    const append = ctx.deps.appendAssistantMessage ?? appendAssistantMessage;
    const errorAssistantMessage: SessionAssistantMessage = {
      role: "assistant",
      ts: Date.now(),
      error: { timestamp: Date.now(), errorMessage, conversationTrace },
    };
    if (response.toolCallHistory && response.toolCallHistory.length > 0) {
      errorAssistantMessage.toolCalls = response.toolCallHistory;
    }
    if (ctx.preAnalysis) errorAssistantMessage.preAnalysis = ctx.preAnalysis;
    await append(ctx.session.sessionId, errorAssistantMessage);
  } catch (err) {
    logger.error("Failed to append error turn to conversation log:", err);
  }

  // Tool-call records are preserved on the appended error assistant message above
  // (via `errorAssistantMessage.toolCalls`). Error report files also capture them.

  const platformLimit = response.platformLimit;
  const errorText = platformLimit
    ? usageLimitText(platformLimit.resetsAt)
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

  // Post error via chat.postMessage. Freeze the surface in place (no discard) so the user
  // sees where the run got stuck; the surface may already be closed if submit_response
  // delivered before the SDK errored.
  await ctx.current.windDown();
  await ctx.client.chat.postMessage({
    channel: ctx.targetChannel,
    thread_ts: ctx.targetThread,
    blocks: ctx.deps.asSlackBlocks(
      platformLimit
        ? ctx.deps.getUsageLimitBlocks(platformLimit.resetsAt)
        : ctx.deps.getErrorBlocksWithRetry(ctx.session.sessionId),
    ),
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
 * Owner escalation for an operator-facing failure Claude flagged via
 * `submit_response.escalate_to_owner`. DMs the diagnostic to the workspace owner and writes an
 * error report (so it also surfaces in `admin_list_error_reports`). Best-effort: no owner, a DM
 * failure, or a report-write failure is logged and swallowed — it never disrupts the turn, and the
 * user only ever sees Claude's acknowledgement, never the raw diagnostic.
 */
async function maybeEscalateToOwner(ctx: DeliveryContext, response: ClaudeResponse): Promise<void> {
  const diagnostic = response.escalateToOwner;
  if (!diagnostic) return;

  try {
    const owner = await ctx.deps.getOwnerUserId();
    if (owner) {
      const userLabel =
        ctx.session.displayName ?? ctx.session.username ?? `<@${ctx.sessionInfo.userId}>`;
      const channelLabel = ctx.session.channelName
        ? `#${ctx.session.channelName}`
        : ctx.sessionInfo.channelId;
      const text = [
        t("owner_escalation.header"),
        t("owner_escalation.context", { user: userLabel, channel: channelLabel }),
        t("owner_escalation.session", { sessionId: ctx.session.sessionId }),
        "",
        diagnostic,
      ].join("\n");
      const sent = await ctx.deps.sendOwnerDm(owner, text, { suppressUnfurls: true });
      if (!sent) logger.warn("owner escalation: DM to owner failed; report still written");
    } else {
      logger.warn("owner escalation: no owner configured; report still written");
    }
  } catch (err) {
    logger.error("owner escalation: DM step failed:", err);
  }

  try {
    await ctx.deps.writeErrorReport({
      sessionId: ctx.session.sessionId,
      errorMessage: diagnostic,
      conversationTrace: response.conversationTrace ?? [],
      ...(response.toolCallHistory &&
        response.toolCallHistory.length > 0 && { toolCallHistory: response.toolCallHistory }),
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error("owner escalation: failed to write error report:", err);
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
 * Persist the Claude response state to the session.
 *
 * Appends a `SessionAssistantMessage` to the unified conversation log carrying the
 * answer, response payload, tool calls, and `postedTopLevel` flag. `stagedIntents`
 * remains session-level (per-turn ephemeral).
 */
async function persistResponseState(
  ctx: DeliveryContext,
  session: SessionContext,
  response: ClaudeResponse,
): Promise<void> {
  const assistantMessage: SessionAssistantMessage = {
    role: "assistant",
    ts: Date.now(),
    text: response.answer,
  };
  if (response.response) assistantMessage.payload = response.response;
  if (response.toolCallHistory && response.toolCallHistory.length > 0) {
    assistantMessage.toolCalls = response.toolCallHistory;
  }
  if (response.postedTopLevel) assistantMessage.postedTopLevel = true;
  if (ctx.preAnalysis) assistantMessage.preAnalysis = ctx.preAnalysis;
  const append = ctx.deps.appendAssistantMessage ?? appendAssistantMessage;
  await append(session.sessionId, assistantMessage);

  if (response.stagedIntents && Object.keys(response.stagedIntents).length > 0) {
    // Merge (not replace): a subsequent turn that stages a different intent
    // must not invalidate refs still attached to buttons posted by earlier
    // turns. The primary writer is now submit_response (before delivery); this
    // is a defense-in-depth pass that also captures orphan intents.
    await ctx.deps.appendStagedIntents(session.sessionId, response.stagedIntents);
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
  return deps.getClaudeOptions(sessionInfo.userId, sessionInfo.triggerType ?? "directMessages", {
    channelId: sessionInfo.channelId,
  });
}
