import type { App, BlockAction } from "@slack/bolt";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";
import { findSessionByThread, getStagedIntent, type SessionContext } from "../../sessions.js";
import type { StagedIntent } from "../../tools/types.js";
import { getRole } from "../../roles.js";
import { canRequestChanges } from "../../permissions.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import { handleFollowUp } from "../../changes/workflow.js";
import type { ChangeResult, FollowUpCommand } from "../../changes/types.js";
import type { SlackDeliveryContext } from "./changeAction.js";
import { SlackStreamer, finalizeStreamedWorkflow } from "../../streaming/slackStreamer.js";
import type { StreamEvent } from "../../streaming/types.js";
import type { UserRole } from "../../roles.js";

export interface ChangeThreadActionsDeps {
  getRole: (userId: string) => Promise<UserRole>;
  canRequestChanges: (role: UserRole) => boolean;
  decodeActionValue: (value: string) => { sessionId: string; ref?: string };
  restoreSession: (sessionId: string) => Promise<SessionInfo | undefined>;
  getStagedIntent: (sessionId: string, ref: string) => Promise<StagedIntent | null>;
  findSessionByThread: (channelId: string, threadTs: string) => Promise<SessionContext | null>;
  handleFollowUp: (
    session: SessionContext,
    command: FollowUpCommand,
    additionalInstructions: string | undefined,
    onEvent: (event: StreamEvent) => void,
  ) => Promise<ChangeResult>;
  errorMessage: (err: unknown) => string;
  createStreamer: (opts: {
    client: App["client"];
    channel: string;
    threadTs: string;
    userId: string;
    thinkingTitle?: string;
  }) => {
    start: () => Promise<boolean>;
    stop: () => Promise<void>;
    handleEvent: (event: StreamEvent) => void;
    hasFailed: boolean;
  };
  finalizeStreamedWorkflow: (
    streamer: ReturnType<ChangeThreadActionsDeps["createStreamer"]>,
    client: App["client"],
    channel: string,
    threadTs: string,
    result: ChangeResult,
    command: FollowUpCommand,
  ) => Promise<void>;
}

export const defaultChangeThreadActionsDeps: ChangeThreadActionsDeps = {
  getRole,
  canRequestChanges,
  decodeActionValue,
  restoreSession: (sessionId: string) => activeSessions.restore(sessionId),
  getStagedIntent,
  findSessionByThread,
  handleFollowUp,
  errorMessage,
  createStreamer: (opts) => new SlackStreamer(opts),
  finalizeStreamedWorkflow: finalizeStreamedWorkflow as never,
};

/**
 * Shared logic for triggering a follow-up action on an existing change.
 * Used by both button click handlers and auto-execute.
 */
export async function triggerFollowUp(
  session: SessionContext,
  command: FollowUpCommand,
  additionalInstructions: string | undefined,
  slack: SlackDeliveryContext,
  deps: ChangeThreadActionsDeps = defaultChangeThreadActionsDeps,
): Promise<void> {
  const { channelId, threadTs, userId, client } = slack;

  // Create streamer for live progress (target DM thread if provided)
  const streamChannel = slack.streamChannel ?? channelId;
  const streamThreadTs = slack.streamThreadTs ?? threadTs;
  const branch = session.activeChange?.branch;
  const streamer = deps.createStreamer({
    client,
    channel: streamChannel,
    threadTs: streamThreadTs,
    userId,
    ...(branch && { thinkingTitle: `Working on ${branch}` }),
  });
  await streamer.start();

  try {
    const result = await deps.handleFollowUp(
      session,
      command,
      additionalInstructions,
      streamer.handleEvent,
    );

    await deps.finalizeStreamedWorkflow(
      streamer,
      client,
      streamChannel,
      streamThreadTs,
      result,
      command,
    );
  } catch (error) {
    logger.error("Follow-up action failed:", error);
    await streamer.stop();
    await client.chat.postMessage({
      channel: streamChannel,
      thread_ts: streamThreadTs,
      text: `Follow-up action failed unexpectedly: ${deps.errorMessage(error)}`,
    });
  }
}

function registerFollowUpActionHandler(
  app: App,
  actionId: string,
  intentType: string,
  command: FollowUpCommand,
  deps: ChangeThreadActionsDeps,
) {
  app.action<BlockAction>(
    new RegExp(`^${actionId}_\\d+$`),
    async ({ ack, body, client, respond }) => {
      await ack();

      const rawValue = (body.actions[0] as { value: string }).value;
      const { sessionId, ref } = deps.decodeActionValue(rawValue);
      const userId = body.user.id;

      // Defense-in-depth: verify the user has dev+ role
      const role = await deps.getRole(userId);
      if (!deps.canRequestChanges(role)) {
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

      const sessionInfo = await deps.restoreSession(sessionId);
      if (!sessionInfo) {
        logger.error(`${actionId} handler: could not restore session ${sessionId}`);
        return;
      }

      const intent = await deps.getStagedIntent(sessionId, ref);
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
      const session = await deps.findSessionByThread(sessionInfo.channelId, sessionInfo.threadTs);
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

      await triggerFollowUp(
        session,
        command,
        additionalInstructions,
        {
          channelId: sessionInfo.channelId,
          threadTs: sessionInfo.threadTs,
          userId,
          client,
        },
        deps,
      );
    },
  );
}

export function registerChangeThreadActionHandlers(
  app: App,
  deps: ChangeThreadActionsDeps = defaultChangeThreadActionsDeps,
): void {
  registerFollowUpActionHandler(app, "clack_review", "review", "review", deps);
  registerFollowUpActionHandler(app, "clack_merge", "merge", "merge", deps);
  registerFollowUpActionHandler(app, "clack_update_change", "update", "update", deps);
  registerFollowUpActionHandler(app, "clack_close", "close", "close", deps);
}
