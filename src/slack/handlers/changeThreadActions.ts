import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession, findSessionByThread, type SessionContext } from "../../sessions.js";
import { decodeActionValue } from "../blocks.js";
import { restoreSessionInfo } from "../state.js";
import type { StagedIntent } from "../../tools/types.js";
import { handleFollowUp } from "../../changes/workflow.js";
import type { FollowUpCommand } from "../../changes/types.js";
import { safeChatUpdate } from "./safeChatUpdate.js";

async function resolveStagedIntentFromSession(sessionId: string, ref: string): Promise<StagedIntent | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  const intents = (session as unknown as Record<string, unknown>).stagedIntents as Record<string, unknown> | undefined;
  if (!intents || !intents[ref]) return null;

  return intents[ref] as StagedIntent;
}

/**
 * Shared logic for triggering a follow-up action on an existing change.
 * Used by both button click handlers and auto-execute.
 * Posts one ack message and updates it in-place with progress.
 */
export async function triggerFollowUp(
  session: SessionContext,
  command: FollowUpCommand,
  additionalInstructions: string | undefined,
  channelId: string,
  threadTs: string,
  client: App["client"]
): Promise<void> {
  // Post one acknowledgment message that we'll update with progress
  const ackMessage = await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `Starting ${command}...`,
  });

  const result = await handleFollowUp(
    session,
    command,
    additionalInstructions,
  );

  if (result.success) {
    await safeChatUpdate(
      client,
      channelId,
      ackMessage.ts!,
      result.summary || `${command} completed successfully.`,
    );
  } else {
    await safeChatUpdate(
      client,
      channelId,
      ackMessage.ts!,
      `${command} failed: ${result.error}`,
    );
  }
}

function registerFollowUpActionHandler(
  app: App,
  actionId: string,
  intentType: string,
  command: FollowUpCommand
) {
  app.action<BlockAction>(actionId, async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, ref } = decodeActionValue(rawValue);
    const userId = body.user.id;

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

    const intent = await resolveStagedIntentFromSession(sessionId, ref);
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
    const additionalInstructions = command === "update" && "instructions" in intent
      ? (intent as { instructions: string }).instructions
      : undefined;

    await triggerFollowUp(session, command, additionalInstructions, sessionInfo.channelId, sessionInfo.threadTs, client);
  });
}

export function registerChangeThreadActionHandlers(app: App): void {
  registerFollowUpActionHandler(app, "clack_review", "review", "review");
  registerFollowUpActionHandler(app, "clack_merge", "merge", "merge");
  registerFollowUpActionHandler(app, "clack_update_change", "update", "update");
  registerFollowUpActionHandler(app, "clack_close", "close", "close");
}
