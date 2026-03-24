import type { App, BlockAction } from "@slack/bolt";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";
import { findSessionByThread, getStagedIntent } from "../../sessions.js";
import { getRole } from "../../roles.js";
import { canRequestChanges } from "../../permissions.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions } from "../activeSessions.js";
import type { StagedChangeIntent } from "../../tools/types.js";
import type { ChangeRequest, ChangePlan, TriggerType } from "../../changes/types.js";
import { startChangeWorkflow } from "../../changes/workflow.js";
import { SlackStreamer, finalizeStreamedWorkflow } from "../../streaming/slackStreamer.js";

/** Slack delivery context shared by change workflow triggers. */
export interface SlackDeliveryContext {
  channelId: string;
  threadTs: string;
  userId: string;
  client: App["client"];
  streamChannel?: string;
  streamThreadTs?: string;
  triggerType?: TriggerType;
}

/**
 * Shared logic for triggering a change workflow from a resolved intent.
 * Used by both the button click handler and auto-execute.
 */
export async function triggerChangeWorkflow(
  intent: StagedChangeIntent,
  slack: SlackDeliveryContext,
): Promise<void> {
  const { channelId, threadTs, userId, client } = slack;

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
  const streamChannel = slack.streamChannel ?? channelId;
  const streamThreadTs = slack.streamThreadTs ?? threadTs;
  const streamer = new SlackStreamer({
    client,
    channel: streamChannel,
    threadTs: streamThreadTs,
    userId,
    thinkingTitle: `Working on ${intent.branch}`,
  });
  await streamer.start();

  try {
    // Build change request and plan
    const request: ChangeRequest = {
      userId,
      message: intent.description,
      triggerType: slack.triggerType ?? "reactions",
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

    await finalizeStreamedWorkflow(streamer, client, streamChannel, streamThreadTs, result, "Change request");
  } catch (error) {
    logger.error("Change workflow failed:", error);
    await streamer.stop();
    await client.chat.postMessage({
      channel: streamChannel,
      thread_ts: streamThreadTs,
      text: `Change request failed unexpectedly: ${errorMessage(error)}`,
    });
  }
}

export function registerChangeActionHandler(app: App): void {
  app.action<BlockAction>(/^clack_change_\d+$/, async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, ref } = decodeActionValue(rawValue);
    const userId = body.user.id;

    // Defense-in-depth: verify the user has dev+ role
    const role = await getRole(userId);
    if (!canRequestChanges(role)) {
      await client.chat.postEphemeral({
        channel: body.channel?.id ?? "",
        user: userId,
        text: "You don't have permission to start changes. Requires dev role or higher.",
      });
      return;
    }

    if (!ref) {
      logger.error("Change action handler: missing ref");
      return;
    }

    // Remove the button message
    await respond({ delete_original: true });

    const sessionInfo = await activeSessions.restore(sessionId);
    if (!sessionInfo) {
      logger.error(`Change action handler: could not restore session ${sessionId}`);
      return;
    }

    // Resolve the staged intent
    const intent = await getStagedIntent(sessionId, ref);
    if (!intent || intent.type !== "change") {
      logger.error(`Change action handler: could not resolve change intent ref ${ref}`);
      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: userId,
        thread_ts: sessionInfo.threadTs,
        text: "Sorry, this change request has expired. Please try again.",
      });
      return;
    }

    await triggerChangeWorkflow(intent, {
      channelId: sessionInfo.channelId,
      threadTs: sessionInfo.threadTs,
      userId,
      client,
      triggerType: sessionInfo.triggerType,
    });
  });
}
