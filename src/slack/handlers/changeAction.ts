import type { App, BlockAction } from "@slack/bolt";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";
import { t } from "../../i18n/t.js";
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
import { stripClickedButton } from "../stripClickedButton.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import type { StagedChangeIntent } from "../../tools/types.js";
import type { ChangeRequest, ChangePlan, ChangeResult, TriggerType } from "../../changes/types.js";
import { startChangeWorkflow, type WorkflowDeps } from "../../changes/workflow.js";
import { maybeOfferRecovery } from "./changeThreadActions.js";
import { provisionSpinoffSiblings } from "./spinoffSiblings.js";
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
  setAttentionLevel: (sessionId: string, level: AttentionLevel) => Promise<void>;
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
  provisionSpinoffSiblings: typeof provisionSpinoffSiblings;
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
  setAttentionLevel,
  createStreamer: (opts) => new SlackStreamer(opts),
  finalizeStreamedWorkflow: (streamer, client, channel, threadTs, result, context) =>
    finalizeStreamedWorkflow(streamer as SlackStreamer, client, channel, threadTs, result, context),
  provisionSpinoffSiblings,
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
  /**
   * When true, suppress all Slack output for the change run: the live progress streamer, queue
   * acks, the finalize message, the recovery offer, and the worker `report_status` posts. The
   * change still executes and opens a PR. See the `silent-change-execution` capability.
   */
  silent?: boolean;
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
  if (!isEngaged(session)) {
    logger.info(
      `Re-engaging session ${session.sessionId} via change-accept button click in ${channelId}`,
    );
    await deps.setAttentionLevel(session.sessionId, "medium");
  }

  // Create streamer for live progress (target DM thread if provided). A silent run posts nothing,
  // so use a no-op streamer and skip the queue-ack / finalize / recovery posts below.
  const silent = slack.silent ?? false;
  const streamChannel = slack.streamChannel ?? channelId;
  const streamThreadTs = slack.streamThreadTs ?? threadTs;
  const streamer = silent
    ? createNoopChangeStreamer()
    : deps.createStreamer({
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
      ...(silent && { silent: true }),
    };

    const plan: ChangePlan = {
      branchName: intent.branch,
      description: intent.description,
      targetRepo: intent.repo,
      ...(intent.plan && { plan: intent.plan }),
      ...(intent.resumeRemoteBranch && { resumeRemoteBranch: true }),
    };

    // Slack-side ack for queue-position events. The workflow fires this when
    // `pool.acquire` enqueues (reusable mode at maxConcurrent). Posted on the
    // same thread the streamer is using so the user sees it without scrolling.
    // A silent run posts nothing, so it gets no ack.
    const onAck = silent
      ? undefined
      : async (text: string): Promise<void> => {
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

    if (!silent) {
      await deps.finalizeStreamedWorkflow(
        streamer,
        client,
        streamChannel,
        streamThreadTs,
        result,
        "Change request",
      );

      await maybeOfferRecovery(session.sessionId, client, streamChannel, streamThreadTs);
    }

    // Spin off any slices the worker carved out into their own standalone sibling threads.
    if (result.success && result.spinoffs && result.spinoffs.length > 0) {
      await deps.provisionSpinoffSiblings({
        spinoffs: result.spinoffs,
        repo: intent.repo,
        channel: channelId,
        userId,
        ...(userDisplayName && { userDisplayName }),
        triggerType: slack.triggerType ?? "reactions",
        parentThreadTs: threadTs,
        client,
      });
    }
  } catch (error) {
    logger.error("Change workflow failed:", error);
    await streamer.stop();
    if (!silent) {
      await client.chat.postMessage({
        channel: streamChannel,
        thread_ts: streamThreadTs,
        text: t("errors.change_failed_unexpectedly", { error: deps.errorMessage(error) }),
      });
    }
  }
}

/** No-op streamer for silent change runs — satisfies the streamer interface, posts nothing. */
function createNoopChangeStreamer(): ReturnType<ChangeActionDeps["createStreamer"]> {
  return {
    start: async () => true,
    stop: async () => {},
    handleEvent: () => {},
    hasFailed: false,
  };
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

    const stripped = stripClickedButton(body.message, body.actions[0]?.action_id);
    if (stripped) {
      await respond({ replace_original: true, ...stripped });
    }

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
