/**
 * Shared response posting logic for button handlers.
 * All responses are posted as regular thread messages.
 */
import type { App } from "@slack/bolt";
import { ErrorCode, type WebAPIPlatformError } from "@slack/web-api";
import type { SessionInfo } from "../state.js";
import type { AskClaudeOptions, ClaudeResponse } from "../../claude.js";
import { getStructuredResponseBlocks, getErrorBlocksWithRetry } from "../blocks.js";
import { setLastAnswer, updateSession, addError, getSession, addRefinement } from "../../sessions.js";
import { askClaude, analyzeError } from "../../claude.js";
import { sendErrorReport } from "../messagesApi.js";
import { getConfig } from "../../config.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { logger } from "../../logger.js";

type RespondFn = (response: { delete_original?: boolean; replace_original?: boolean; text?: string }) => Promise<unknown>;

/**
 * Dismiss the original message (no-op for regular messages).
 */
export async function dismissOriginal(
  _respond: RespondFn,
  _sessionInfo: SessionInfo,
): Promise<void> {
  // No-op — streaming messages can't be deleted via respond()
}

/**
 * Post a response message to the user in the thread.
 */
export async function postResponse(
  client: App["client"],
  sessionInfo: SessionInfo,
  options: { blocks?: unknown[]; text: string },
): Promise<void> {
  await client.chat.postMessage({
    channel: sessionInfo.channelId,
    thread_ts: sessionInfo.threadTs,
    ...(options.blocks ? { blocks: options.blocks as any[] } : {}),
    text: options.text,
  });
}

/**
 * Post a successful Claude response (with blocks if structured).
 */
export async function postSuccessResponse(
  client: App["client"],
  sessionInfo: SessionInfo,
  sessionId: string,
  response: ClaudeResponse,
): Promise<void> {
  await setLastAnswer(sessionId, response.answer);

  // Persist tool state
  const updates: Record<string, unknown> = {};
  if (response.response) updates.lastResponse = response.response;
  if (response.stagedIntents && Object.keys(response.stagedIntents).length > 0) updates.stagedIntents = response.stagedIntents;
  if (response.toolCallHistory && response.toolCallHistory.length > 0) updates.toolCallHistory = response.toolCallHistory;
  if (Object.keys(updates).length > 0) await updateSession(sessionId, updates as any);

  // Use pre-rendered blocks when available, otherwise render from payload
  const blocks = response.response
    ? (response.renderedBlocks ?? getStructuredResponseBlocks(response.response, sessionId))
    : undefined;

  await postResponse(client, sessionInfo, {
    blocks: blocks as unknown[] | undefined,
    text: response.answer,
  });
}

/**
 * Post a successful response with retry on block errors (invalid_blocks, msg_too_long).
 * If Slack rejects the blocks, re-invokes Claude via refinement (max 1 retry),
 * then falls back to plain text if retry also fails.
 */
export async function postSuccessResponseWithRetry(
  client: App["client"],
  sessionInfo: SessionInfo,
  sessionId: string,
  response: ClaudeResponse,
): Promise<void> {
  try {
    await postSuccessResponse(client, sessionInfo, sessionId, response);
  } catch (postError) {
    if (!isSlackBlockError(postError)) throw postError;

    const slackError = (postError as WebAPIPlatformError).data?.error ?? "unknown";
    logger.warn(`${slackError} error in button handler for session ${sessionId}, retrying via Claude...`);

    const errorDetail = (postError as WebAPIPlatformError).data?.response_metadata?.messages?.join("; ")
      || `Slack rejected the message with ${slackError}.`;

    await addRefinement(
      sessionId,
      `SYSTEM: Your previous submit_response was rejected by Slack with error "${slackError}". Detail: ${errorDetail}. Your response is too long or has too many sections. Please significantly shorten your answer and call submit_response again.`
    );

    const updatedSession = await getSession(sessionId);
    if (!updatedSession) {
      logger.error("Could not reload session for block validation retry");
      await postResponse(client, sessionInfo, { text: response.answer });
      return;
    }

    const claudeOptions = await getHandlerClaudeOptions(sessionInfo);
    const retryResponse = await askClaude(updatedSession, claudeOptions);

    if (!retryResponse.success) {
      await postErrorResponse(client, sessionInfo, sessionId, retryResponse);
      return;
    }

    try {
      await postSuccessResponse(client, sessionInfo, sessionId, retryResponse);
    } catch (retryPostError) {
      // Exhausted retries — fall back to plain text
      logger.warn("Button handler retry also produced invalid blocks, falling back to plain text");
      await postResponse(client, sessionInfo, { text: retryResponse.answer });
    }
  }
}

function isSlackBlockError(error: unknown): error is WebAPIPlatformError {
  if (!(error instanceof Error)) return false;
  const code = (error as WebAPIPlatformError).data?.error;
  return (
    (error as WebAPIPlatformError).code === ErrorCode.PlatformError &&
    (code === "invalid_blocks" || code === "msg_too_long")
  );
}

/**
 * Post an error response with retry button and optional DM report.
 */
export async function postErrorResponse(
  client: App["client"],
  sessionInfo: SessionInfo,
  sessionId: string,
  response: ClaudeResponse,
): Promise<void> {
  const errorMessage = response.error || "Unknown error";
  const conversationTrace = response.conversationTrace || [];

  await addError(sessionId, errorMessage, conversationTrace);

  await postResponse(client, sessionInfo, {
    blocks: getErrorBlocksWithRetry(sessionId) as unknown[],
    text: `Claude seems to have crashed (session: ${sessionId}), maybe try again?`,
  });

  const config = getConfig();
  if (config.slack.sendErrorsAsDM) {
    try {
      const analysis = await analyzeError(errorMessage, conversationTrace);
      await sendErrorReport(client, sessionInfo.userId, {
        sessionId,
        errorMessage,
        conversationTrace,
        analysis,
      });
    } catch (dmError) {
      logger.error("Failed to send error report DM:", dmError);
    }
  }
}

/**
 * Build Claude options from session info (role + changes workflow).
 * Delivery context is now derived from the session itself in buildDeliveryContext.
 */
export async function getHandlerClaudeOptions(
  sessionInfo: SessionInfo,
): Promise<AskClaudeOptions> {
  return getClaudeOptions(
    sessionInfo.userId,
    sessionInfo.triggerType ?? "directMessages",
  );
}
