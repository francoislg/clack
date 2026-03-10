import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession, findSessionByThread } from "../../sessions.js";
import { decodeActionValue } from "../blocks.js";
import { restoreSessionInfo } from "../state.js";
import type { StagedChangeIntent } from "../../tools/types.js";
import type { ChangeRequest, ChangePlan } from "../../changes/types.js";
import { startChangeWorkflow } from "../../changes/workflow.js";
import { SlackStreamer } from "../../streaming/slackStreamer.js";

/**
 * Resolve staged intents from session storage.
 * The stagedIntents are saved in the session context by askClaude().
 */
async function resolveStagedIntent(sessionId: string, ref: string): Promise<StagedChangeIntent | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  // stagedIntents are stored as a Record<string, StagedIntent> on the session
  const intents = (session as unknown as Record<string, unknown>).stagedIntents as Record<string, unknown> | undefined;
  if (!intents || !intents[ref]) return null;

  const intent = intents[ref] as StagedChangeIntent;
  if (intent.type !== "change") return null;

  return intent;
}

/**
 * Shared logic for triggering a change workflow from a resolved intent.
 * Used by both the button click handler and auto-execute.
 */
export async function triggerChangeWorkflow(
  intent: StagedChangeIntent,
  channelId: string,
  threadTs: string,
  userId: string,
  client: App["client"],
  opts?: { streamChannel?: string; streamThreadTs?: string },
): Promise<void> {
  // Find the unified session for this thread
  const session = await findSessionByThread(channelId, threadTs);
  if (!session) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "Could not find an active session for this thread.",
    });
    return;
  }

  // Create streamer for live progress (target DM thread if provided)
  const streamChannel = opts?.streamChannel ?? channelId;
  const streamThreadTs = opts?.streamThreadTs ?? threadTs;
  const streamer = new SlackStreamer({ client, channel: streamChannel, threadTs: streamThreadTs, userId });
  await streamer.start();

  try {
    // Build change request and plan
    const request: ChangeRequest = {
      userId,
      message: intent.description,
      triggerType: "reactions",
      channel: channelId,
      messageTs: threadTs,
    };

    const plan: ChangePlan = {
      branchName: intent.branch,
      description: intent.description,
      targetRepo: intent.repo,
    };

    const result = await startChangeWorkflow(
      request,
      plan,
      session.sessionId,
      streamer.handleEvent,
    );

    if (result.success) {
      // Worker Claude already reported completion via report_status — just stop the stream quietly.
      await streamer.stop();
    } else {
      const message = `Change request failed: ${result.error}`;
      if (streamer.hasFailed) {
        await streamer.stop();
        await client.chat.postMessage({ channel: streamChannel, thread_ts: streamThreadTs, text: message });
      } else {
        await streamer.stop({ markdownText: message });
      }
    }
  } catch (error) {
    logger.error("Change workflow failed:", error);
    await streamer.stop();
    await client.chat.postMessage({
      channel: streamChannel,
      thread_ts: streamThreadTs,
      text: `Change request failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function registerChangeActionHandler(app: App): void {
  app.action<BlockAction>(/^clack_change_\d+$/, async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, ref } = decodeActionValue(rawValue);
    const userId = body.user.id;

    if (!ref) {
      logger.error("Change action handler: missing ref");
      return;
    }

    // Remove the button message
    await respond({ delete_original: true });

    const sessionInfo = await restoreSessionInfo(sessionId);
    if (!sessionInfo) {
      logger.error(`Change action handler: could not restore session ${sessionId}`);
      return;
    }

    // Resolve the staged intent
    const intent = await resolveStagedIntent(sessionId, ref);
    if (!intent) {
      logger.error(`Change action handler: could not resolve intent ref ${ref}`);
      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: userId,
        thread_ts: sessionInfo.threadTs,
        text: "Sorry, this change request has expired. Please try again.",
      });
      return;
    }

    await triggerChangeWorkflow(intent, sessionInfo.channelId, sessionInfo.threadTs, userId, client);
  });
}
