import type { App, BlockAction } from "@slack/bolt";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";
import { findSessionByThread, getStagedIntent, type SessionContext } from "../../sessions.js";
import { getRole } from "../../roles.js";
import { canRequestChanges } from "../../permissions.js";
import { decodeActionValue } from "../blocks.js";
import { restoreSessionInfo } from "../state.js";
import { handleFollowUp } from "../../changes/workflow.js";
import type { FollowUpCommand } from "../../changes/types.js";
import type { SlackDeliveryContext } from "./changeAction.js";
import { SlackStreamer, finalizeStreamedWorkflow } from "../../streaming/slackStreamer.js";

/**
 * Shared logic for triggering a follow-up action on an existing change.
 * Used by both button click handlers and auto-execute.
 */
export async function triggerFollowUp(
  session: SessionContext,
  command: FollowUpCommand,
  additionalInstructions: string | undefined,
  slack: SlackDeliveryContext,
): Promise<void> {
  const { channelId, threadTs, userId, client } = slack;

  // Create streamer for live progress (target DM thread if provided)
  const streamChannel = slack.streamChannel ?? channelId;
  const streamThreadTs = slack.streamThreadTs ?? threadTs;
  const streamer = new SlackStreamer({ client, channel: streamChannel, threadTs: streamThreadTs, userId });
  await streamer.start();

  try {
    const result = await handleFollowUp(
      session,
      command,
      additionalInstructions,
      streamer.handleEvent,
    );

    await finalizeStreamedWorkflow(streamer, client, streamChannel, streamThreadTs, result, command);
  } catch (error) {
    logger.error("Follow-up action failed:", error);
    await streamer.stop();
    await client.chat.postMessage({
      channel: streamChannel,
      thread_ts: streamThreadTs,
      text: `Follow-up action failed unexpectedly: ${errorMessage(error)}`,
    });
  }
}

function registerFollowUpActionHandler(
  app: App,
  actionId: string,
  intentType: string,
  command: FollowUpCommand
) {
  app.action<BlockAction>(new RegExp(`^${actionId}_\\d+$`), async ({ ack, body, client, respond }) => {
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
        text: "You don't have permission to perform change actions. Requires dev role or higher.",
      });
      return;
    }

    if (!ref) {
      logger.error(`${actionId} handler: missing ref`);
      return;
    }

    await respond({ delete_original: true });

    const sessionInfo = await restoreSessionInfo(sessionId);
    if (!sessionInfo) {
      logger.error(`${actionId} handler: could not restore session ${sessionId}`);
      return;
    }

    const intent = await getStagedIntent(sessionId, ref);
    if (!intent || intent.type !== intentType) {
      logger.error(`${actionId} handler: could not resolve ${intentType} intent ref ${ref}`);
      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: userId,
        thread_ts: sessionInfo.threadTs,
        text: "Sorry, this action has expired. Please try again.",
      });
      return;
    }

    // Find the unified session for this thread
    const session = await findSessionByThread(sessionInfo.channelId, sessionInfo.threadTs);
    if (!session?.activeChange) {
      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: userId,
        thread_ts: sessionInfo.threadTs,
        text: "No active change found in this thread.",
      });
      return;
    }

    // Extract additional instructions for update commands
    const additionalInstructions = intent.type === "update" ? intent.instructions : undefined;

    await triggerFollowUp(session, command, additionalInstructions, {
      channelId: sessionInfo.channelId,
      threadTs: sessionInfo.threadTs,
      userId,
      client,
    });
  });
}

export function registerChangeThreadActionHandlers(app: App): void {
  registerFollowUpActionHandler(app, "clack_review", "review", "review");
  registerFollowUpActionHandler(app, "clack_merge", "merge", "merge");
  registerFollowUpActionHandler(app, "clack_update_change", "update", "update");
  registerFollowUpActionHandler(app, "clack_close", "close", "close");
}
