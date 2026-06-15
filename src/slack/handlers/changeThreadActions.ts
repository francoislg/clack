import type { App, BlockAction } from "@slack/bolt";
import { errorMessage } from "../../errors.js";
import { t } from "../../i18n/t.js";
import { logger } from "../../logger.js";
import {
  findSessionByThread,
  getStagedIntent,
  setAttentionLevel,
  isEngaged,
  type AttentionLevel,
  type SessionContext,
} from "../../sessions.js";
import type { StagedIntent } from "../../tools/types.js";
import { getRole } from "../../roles.js";
import { canRequestChanges } from "../../permissions.js";
import { decodeActionValue, getChangeRecoveryBlocks } from "../blocks.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import { handleFollowUp } from "../../changes/workflow.js";
import { getActiveChange, type ActiveChangeState } from "../../changes/activeState.js";
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
    deps?: never,
    userFeedback?: string,
  ) => Promise<ChangeResult>;
  errorMessage: (err: unknown) => string;
  setAttentionLevel: (sessionId: string, level: AttentionLevel) => Promise<void>;
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
  getActiveChange: (sessionId: string) => ActiveChangeState | undefined;
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
  setAttentionLevel,
  getActiveChange,
  createStreamer: (opts) => new SlackStreamer(opts),
  finalizeStreamedWorkflow: finalizeStreamedWorkflow as never,
};

/**
 * Offer the recovery actions (Continue / Start over / Discard) under the failure
 * message when the thread's change ended up `failed`. No-op for any other status.
 */
export async function maybeOfferRecovery(
  sessionId: string,
  client: App["client"],
  channel: string,
  threadTs: string,
  deps: Pick<ChangeThreadActionsDeps, "getActiveChange"> = defaultChangeThreadActionsDeps,
): Promise<void> {
  if (deps.getActiveChange(sessionId)?.status !== "failed") return;
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: t("changes.recovery.prompt"),
    blocks: getChangeRecoveryBlocks(sessionId),
  });
}

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
  userFeedback?: string,
): Promise<void> {
  const { channelId, threadTs, userId, client } = slack;

  // Re-engage the thread if it was silenced by a stop gesture. Mirrors the
  // @mention re-engagement: clicking a change-thread button signals the user
  // wants to keep working and expects Clack to respond in this thread again.
  if (!isEngaged(session)) {
    logger.info(
      `Re-engaging session ${session.sessionId} via change-thread button click in ${channelId}`,
    );
    await deps.setAttentionLevel(session.sessionId, "medium");
  }

  // Create streamer for live progress (target DM thread if provided)
  const streamChannel = slack.streamChannel ?? channelId;
  const streamThreadTs = slack.streamThreadTs ?? threadTs;
  const branch = session.activeChange?.branch;
  const streamer = deps.createStreamer({
    client,
    channel: streamChannel,
    threadTs: streamThreadTs,
    userId,
    ...(branch && { thinkingTitle: t("streamer.working_on", { branch }) }),
  });
  await streamer.start();

  try {
    const result = await deps.handleFollowUp(
      session,
      command,
      additionalInstructions,
      streamer.handleEvent,
      undefined,
      userFeedback,
    );

    await deps.finalizeStreamedWorkflow(
      streamer,
      client,
      streamChannel,
      streamThreadTs,
      result,
      command,
    );

    await maybeOfferRecovery(session.sessionId, client, streamChannel, streamThreadTs, deps);
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
          text: t("errors.change_action_permission_denied"),
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
          text: t("errors.change_action_expired"),
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
          text: t("errors.no_active_change_thread"),
        });
        return;
      }

      // Extract additional instructions and user feedback for update commands
      const additionalInstructions = intent.type === "update" ? intent.instructions : undefined;
      const userFeedback = intent.type === "update" ? intent.userFeedback : undefined;

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
        userFeedback,
      );
    },
  );
}

/**
 * Recovery buttons (Continue / Start over / Discard) are not backed by a staged
 * intent — the command is implied by the action_id and the value carries only the
 * session ID, so this handler skips the intent-resolution step of the follow-up
 * handler above.
 */
function registerRecoveryActionHandler(
  app: App,
  actionId: string,
  command: FollowUpCommand,
  deps: ChangeThreadActionsDeps,
) {
  app.action<BlockAction>(
    new RegExp(`^${actionId}_\\d+$`),
    async ({ ack, body, client, respond }) => {
      await ack();

      const rawValue = (body.actions[0] as { value: string }).value;
      const { sessionId } = deps.decodeActionValue(rawValue);
      const userId = body.user.id;

      const role = await deps.getRole(userId);
      if (!deps.canRequestChanges(role)) {
        await client.chat.postEphemeral({
          channel: body.channel?.id ?? "",
          user: userId,
          text: t("errors.change_action_permission_denied"),
        });
        return;
      }

      const sessionInfo = await deps.restoreSession(sessionId);
      if (!sessionInfo) {
        logger.error(`${actionId} handler: could not restore session ${sessionId}`);
        return;
      }

      const session = await deps.findSessionByThread(sessionInfo.channelId, sessionInfo.threadTs);
      if (!session?.activeChange) {
        await client.chat.postEphemeral({
          channel: sessionInfo.channelId,
          user: userId,
          thread_ts: sessionInfo.threadTs,
          text: t("errors.no_active_change_thread"),
        });
        return;
      }

      await respond({ delete_original: true });

      await triggerFollowUp(
        session,
        command,
        undefined,
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
  registerRecoveryActionHandler(app, "clack_continue_change", "continue", deps);
  registerRecoveryActionHandler(app, "clack_restart_change", "restart", deps);
  registerRecoveryActionHandler(app, "clack_discard_change", "discard", deps);
}
