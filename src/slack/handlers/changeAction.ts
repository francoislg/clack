import type { App, BlockAction } from "@slack/bolt";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";
import { t } from "../../i18n/t.js";
import {
  findSessionByThread,
  getStagedIntent,
  setAutoResponseActive,
  type SessionContext,
} from "../../sessions.js";
import type { StagedIntent } from "../../tools/types.js";
import { getRole } from "../../roles.js";
import { canRequestChanges } from "../../permissions.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import type { StagedChangeIntent } from "../../tools/types.js";
import type { ChangeRequest, ChangePlan, ChangeResult, TriggerType } from "../../changes/types.js";
import { startChangeWorkflow, type WorkflowDeps } from "../../changes/workflow.js";
import { SlackStreamer, finalizeStreamedWorkflow } from "../../streaming/slackStreamer.js";
import type { StreamEvent } from "../../streaming/types.js";
import type { UserRole } from "../../roles.js";
import { getUserInfo } from "../userCache.js";

export interface ChangeActionDeps {
  getRole: (userId: string) => Promise<UserRole>;
  canRequestChanges: (role: UserRole) => boolean;
  decodeActionValue: (value: string) => { sessionId: string; ref?: string };
  restoreSession: (sessionId: string) => Promise<SessionInfo | undefined>;
  getStagedIntent: (sessionId: string, ref: string) => Promise<StagedIntent | null>;
  findSessionByThread: (channelId: string, threadTs: string) => Promise<SessionContext | null>;
  startChangeWorkflow: (
    request: ChangeRequest,
    plan: ChangePlan,
    sessionId: string,
    onEvent: (event: StreamEvent) => void,
    deps?: WorkflowDeps,
    onAck?: (text: string) => Promise<void>,
  ) => Promise<ChangeResult>;
  errorMessage: (err: unknown) => string;
  setAutoResponseActive: (sessionId: string, active: boolean) => Promise<void>;
  createStreamer: (opts: {
    client: App["client"];
    channel: string;
    threadTs: string;
    userId: string;
    thinkingTitle: string;
  }) => {
    start: () => Promise<boolean>;
    stop: () => Promise<void>;
    handleEvent: (event: StreamEvent) => void;
    hasFailed: boolean;
  };
  finalizeStreamedWorkflow: (
    streamer: ReturnType<ChangeActionDeps["createStreamer"]>,
    client: App["client"],
    channel: string,
    threadTs: string,
    result: ChangeResult,
    context: string,
  ) => Promise<void>;
}

export const defaultChangeActionDeps: ChangeActionDeps = {
  getRole,
  canRequestChanges,
  decodeActionValue,
  restoreSession: (sessionId: string) => activeSessions.restore(sessionId),
  getStagedIntent,
  findSessionByThread,
  startChangeWorkflow,
  errorMessage,
  setAutoResponseActive,
  createStreamer: (opts) => new SlackStreamer(opts),
  finalizeStreamedWorkflow: finalizeStreamedWorkflow as never,
};

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
  deps: ChangeActionDeps = defaultChangeActionDeps,
): Promise<void> {
  const { channelId, threadTs, userId, client } = slack;

  // Find the unified session for this thread
  const session = await deps.findSessionByThread(channelId, threadTs);
  if (!session) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: t("errors.no_active_session"),
    });
    return;
  }

  // Re-engage the thread if a stop gesture had silenced it. Clicking Accept/
  // Edit/Reject on a change proposal signals the user is back in the loop.
  if (session.autoResponseActive === false) {
    logger.info(
      `Re-engaging session ${session.sessionId} via change-accept button click in ${channelId}`,
    );
    await deps.setAutoResponseActive(session.sessionId, true);
  }

  // Create streamer for live progress (target DM thread if provided)
  const streamChannel = slack.streamChannel ?? channelId;
  const streamThreadTs = slack.streamThreadTs ?? threadTs;
  const streamer = deps.createStreamer({
    client,
    channel: streamChannel,
    threadTs: streamThreadTs,
    userId,
    thinkingTitle: t("streamer.working_on", { branch: intent.branch }),
  });
  await streamer.start();

  try {
    const userInfo = await getUserInfo(client, userId);
    const userDisplayName = userInfo?.displayName || userInfo?.username;

    // Build change request and plan
    const request: ChangeRequest = {
      userId,
      ...(userDisplayName && { userDisplayName }),
      message: intent.description,
      triggerType: slack.triggerType ?? "reactions",
      channel: channelId,
      messageTs: threadTs,
    };

    const plan: ChangePlan = {
      branchName: intent.branch,
      description: intent.description,
      targetRepo: intent.repo,
      ...(intent.plan && { plan: intent.plan }),
    };

    // Slack-side ack for queue-position events. The workflow fires this when
    // `pool.acquire` enqueues (reusable mode at maxConcurrent). Posted on the
    // same thread the streamer is using so the user sees it without scrolling.
    const onAck = async (text: string): Promise<void> => {
      await client.chat.postMessage({
        channel: streamChannel,
        thread_ts: streamThreadTs,
        text,
      });
    };

    const result = await deps.startChangeWorkflow(
      request,
      plan,
      session.sessionId,
      streamer.handleEvent,
      undefined,
      onAck,
    );

    await deps.finalizeStreamedWorkflow(
      streamer,
      client,
      streamChannel,
      streamThreadTs,
      result,
      "Change request",
    );
  } catch (error) {
    logger.error("Change workflow failed:", error);
    await streamer.stop();
    await client.chat.postMessage({
      channel: streamChannel,
      thread_ts: streamThreadTs,
      text: t("errors.change_failed_unexpectedly", { error: deps.errorMessage(error) }),
    });
  }
}

export function registerChangeActionHandler(
  app: App,
  deps: ChangeActionDeps = defaultChangeActionDeps,
): void {
  app.action<BlockAction>(/^clack_change_\d+$/, async ({ ack, body, client, respond }) => {
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
        text: t("errors.change_permission_denied"),
      });
      return;
    }

    if (!ref) {
      logger.error("Change action handler: missing ref");
      return;
    }

    // Remove the button message
    await respond({ delete_original: true });

    const sessionInfo = await deps.restoreSession(sessionId);
    if (!sessionInfo) {
      logger.error(`Change action handler: could not restore session ${sessionId}`);
      return;
    }

    // Resolve the staged intent
    const intent = await deps.getStagedIntent(sessionId, ref);
    if (!intent || intent.type !== "change") {
      logger.error(`Change action handler: could not resolve change intent ref ${ref}`);
      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: userId,
        thread_ts: sessionInfo.threadTs,
        text: t("errors.change_expired"),
      });
      return;
    }

    await triggerChangeWorkflow(
      intent,
      {
        channelId: sessionInfo.channelId,
        threadTs: sessionInfo.threadTs,
        userId,
        client,
        triggerType: sessionInfo.triggerType,
      },
      deps,
    );
  });
}
