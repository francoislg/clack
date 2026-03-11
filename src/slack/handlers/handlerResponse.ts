/**
 * Shared response posting and delivery logic.
 *
 * `executeAndDeliver` is the single code path for all Claude → Slack delivery.
 * Trigger-specific callers (processMessage, button handlers) prepare context,
 * then hand off to executeAndDeliver for streaming, delivery, and error handling.
 */
import type { App } from "@slack/bolt";
import type { SessionInfo } from "../state.js";
import type { SessionContext } from "../../sessions.js";
import type { AskClaudeOptions, ClaudeResponse } from "../../claude/index.js";
import type { DeliverFn } from "../../tools/types.js";
import { getErrorBlocksWithRetry } from "../blocks.js";
import { setLastAnswer, updateSession, addError } from "../../sessions.js";
import { askClaude } from "../../claude/index.js";
import { analyzeError } from "../../claude/utilities.js";
import { sendErrorReport } from "../messagesApi.js";
import { getConfig } from "../../config.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { handleAutoExecuteActions } from "./autoExecute.js";
import { SlackStreamer } from "../../streaming/slackStreamer.js";
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
}

/**
 * Single code path for all Claude → Slack delivery.
 * Trigger-agnostic: reads sessionInfo to derive target channel/thread.
 * Handles streaming, delivery via submit_response, error reporting, and auto-execute.
 */
export async function executeAndDeliver(params: ExecuteAndDeliverParams): Promise<ClaudeResponse> {
  const { client, session, sessionInfo, claudeOptions, abortController } = params;

  // 3.2: Derive target from sessionInfo (DM-aware)
  const targetChannel = sessionInfo.dmChannel ?? sessionInfo.channelId;
  const targetThread = sessionInfo.dmThreadTs ?? sessionInfo.threadTs;

  // Create streamer targeting the derived channel/thread
  const streamer = new SlackStreamer({
    client,
    channel: targetChannel,
    threadTs: targetThread,
    userId: sessionInfo.userId,
    // teamId omitted — SlackStreamer.start() falls back to client.auth.test() internally
  });

  const streamStarted = await streamer.start();
  if (!streamStarted) {
    logger.warn("Stream failed to start, will fall back to one-shot posting");
  }

  // 3.3: Construct DeliverFn closing over streamer + chat.postMessage fallback
  let alreadyDelivered = false;
  const deliver: DeliverFn = async (opts) => {
    if (alreadyDelivered) {
      return { ok: false as const, error: "Response already delivered" };
    }

    try {
      if (!streamer.hasFailed) {
        // Finalize the stream message with the answer content.
        // The streaming API supports long markdown and renders it natively.
        await streamer.stop({
          markdownText: opts.markdownText,
          ...(opts.blocks && { blocks: opts.blocks }),
        });

        if (!streamer.hasFailed) {
          alreadyDelivered = true;

          // Stream edits don't trigger Slack notifications.
          // Post a short follow-up message so the user gets pinged.
          if (await getUserPreference(sessionInfo.userId, "notifyOnResponse")) {
            await client.chat.postMessage({
              channel: targetChannel,
              thread_ts: targetThread,
              text: "Response ready! Need anything else?",
            });
          }

          return { ok: true as const };
        }
        // Stop failed — fall through to chat.postMessage fallback
      }

      // Fallback: post via chat.postMessage
      await client.chat.postMessage({
        channel: targetChannel,
        thread_ts: targetThread,
        text: opts.markdownText,
        ...(opts.blocks && { blocks: opts.blocks as any[] }),
      });
      alreadyDelivered = true;
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Delivery failed:", error);
      return { ok: false as const, error: message };
    }
  };

  try {
    // 3.4: Call askClaude with deliver callback + streaming events
    logger.info(
      `Calling Claude (session: ${session.sessionId}, role: ${claudeOptions.role ?? "member"}, changesWorkflow: ${claudeOptions.changesWorkflowEnabled ?? false})`
    );
    const response = await askClaude(session, {
      ...claudeOptions,
      slackClient: client,
      deliver,
      onEvent: streamer.handleEvent,
      abortController,
    });

    // 3.5: Cancellation path
    if (response.cancelled) {
      if (!alreadyDelivered) {
        await streamer.stop({ markdownText: "_Request cancelled._" });
        if (streamer.hasFailed) {
          await client.chat.postMessage({
            channel: targetChannel,
            thread_ts: targetThread,
            text: "_Request cancelled._",
          });
        }
      }
      return response;
    }

    // 3.6 + 3.7: Success paths
    if (response.success) {
      await persistResponseState(session, response);

      if (!alreadyDelivered) {
        // 3.7: submit_response was NOT called — deliver raw text via stream
        await streamer.stop({ markdownText: response.answer });
        if (streamer.hasFailed) {
          await client.chat.postMessage({
            channel: targetChannel,
            thread_ts: targetThread,
            text: response.answer,
          });
        } else if (await getUserPreference(sessionInfo.userId, "notifyOnResponse")) {
          await client.chat.postMessage({
            channel: targetChannel,
            thread_ts: targetThread,
            text: "Response ready! Need anything else?",
          });
        }
      }

      // Auto-execute any actions flagged with auto: true
      await handleAutoExecuteActions({
        client,
        channelId: sessionInfo.channelId,
        threadTs: sessionInfo.threadTs,
        userId: sessionInfo.userId,
        response,
        sessionId: session.sessionId,
        role: claudeOptions.role ?? "member",
        dmChannel: sessionInfo.dmChannel,
        dmThreadTs: sessionInfo.dmThreadTs,
      });
    } else {
      // 3.8: Error path
      const errorMessage = response.error || "Unknown error";
      const conversationTrace = response.conversationTrace || [];

      logger.error("Claude failed:", errorMessage);
      await addError(session.sessionId, errorMessage, conversationTrace);

      const isPlatformLimit = /usage limit|limit reached/i.test(errorMessage);
      const errorText = isPlatformLimit
        ? errorMessage
        : `Claude seems to have crashed (session: ${session.sessionId}), maybe try again?`;

      // Post error via chat.postMessage (stream may already be stopped if submit_response
      // delivered before the SDK errored)
      await streamer.stop();
      await client.chat.postMessage({
        channel: targetChannel,
        thread_ts: targetThread,
        blocks: getErrorBlocksWithRetry(session.sessionId) as any[],
        text: errorText,
      });

      // Optional DM error report
      const config = getConfig();
      if (config.slack.sendErrorsAsDM) {
        try {
          const analysis = await analyzeError(errorMessage, conversationTrace);
          await sendErrorReport(client, sessionInfo.userId, {
            sessionId: session.sessionId,
            errorMessage,
            conversationTrace,
            analysis,
          });
        } catch (dmError) {
          logger.error("Failed to send error report DM:", dmError);
        }
      }
    }

    return response;
  } catch (error) {
    // Unhandled error — stop stream and post fallback
    logger.error("Unhandled error in executeAndDeliver:", error);
    try {
      await streamer.stop({ markdownText: "Something went wrong processing this request." });
      if (streamer.hasFailed) {
        await client.chat.postMessage({
          channel: targetChannel,
          thread_ts: targetThread,
          text: "Something went wrong processing this request.",
        });
      }
    } catch {
      // Last resort — stream is unrecoverable
    }
    throw error;
  } finally {
    // 3.9: Ensure stream is stopped (idempotent no-op if already stopped)
    await streamer.stop();
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
  options: { blocks?: unknown[]; text: string },
): Promise<void> {
  const channel = sessionInfo.dmChannel || sessionInfo.channelId;
  const threadTs = sessionInfo.dmThreadTs || sessionInfo.threadTs;

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    ...(options.blocks ? { blocks: options.blocks as any[] } : {}),
    text: options.text,
  });
}

/**
 * Build Claude options from session info (role + changes workflow).
 */
export async function getHandlerClaudeOptions(
  sessionInfo: SessionInfo,
): Promise<AskClaudeOptions> {
  return getClaudeOptions(
    sessionInfo.userId,
    sessionInfo.triggerType ?? "directMessages",
  );
}
