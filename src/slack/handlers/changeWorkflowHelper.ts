import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getRole } from "../../roles.js";
import type { AskClaudeOptions, ChangeRequestInfo, ResumeRequestInfo } from "../../claude.js";
import type { ChangeRequest, ChangePlan, TriggerType } from "../../changes/types.js";
import { isChangesEnabledForTrigger, getChangeEnabledRepos } from "../../changes/detection.js";
import { getResumableSessions, readSessionState } from "../../changes/persistence.js";
import { startChangeWorkflow } from "../../changes/workflow.js";

/**
 * Get Claude options for a user and trigger type
 */
export async function getClaudeOptions(
  userId: string,
  triggerType: TriggerType
): Promise<AskClaudeOptions> {
  const config = getConfig();
  const role = await getRole(userId);

  const changesEnabled = isChangesEnabledForTrigger(triggerType, config);
  const isChangeCapable = changesEnabled && (role === "dev" || role === "admin" || role === "owner");

  if (!isChangeCapable) {
    return { role, changesWorkflowEnabled: false };
  }

  const availableRepos = getChangeEnabledRepos(config);
  if (availableRepos.length === 0) {
    return { role, changesWorkflowEnabled: false };
  }

  // Get resumable sessions
  const resumableSessions = getResumableSessions().map((s) => ({
    branchName: s.branchName,
    repo: s.repo,
    description: s.description,
    phase: s.phase,
  }));

  return {
    role,
    changesWorkflowEnabled: true,
    availableRepos,
    resumableSessions: resumableSessions.length > 0 ? resumableSessions : undefined,
  };
}

/**
 * Handle a change request detected by Claude
 */
export async function handleChangeRequest(
  client: App["client"],
  userId: string,
  channelId: string,
  messageTs: string,
  messageText: string,
  changeRequestInfo: ChangeRequestInfo,
  triggerType: TriggerType,
  threadTs?: string
): Promise<void> {
  const effectiveThreadTs = threadTs || messageTs;

  logger.debug(`Change request from user ${userId} in channel ${channelId} (trigger: ${triggerType})`);

  // Post acknowledgment message
  const ackMessage = await client.chat.postMessage({
    channel: channelId,
    thread_ts: effectiveThreadTs,
    text: "Starting change request...",
  });

  const request: ChangeRequest = {
    userId,
    message: messageText,
    triggerType,
    channel: channelId,
    messageTs,
    threadTs,
  };

  // Convert ChangeRequestInfo to ChangePlan
  const plan: ChangePlan = {
    branchName: changeRequestInfo.branch,
    description: changeRequestInfo.description,
    targetRepo: changeRequestInfo.repo,
  };

  const result = await startChangeWorkflow(
    request,
    plan,
    effectiveThreadTs,
    async (progressMessage: string) => {
      try {
        await client.chat.update({
          channel: channelId,
          ts: ackMessage.ts!,
          text: progressMessage,
        });
      } catch (error) {
        logger.warn("Failed to update progress message:", error);
      }
    }
  );

  if (result.success) {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `✅ PR created: ${result.prUrl}\n\n${result.summary || ""}`.trim(),
    });
  } else {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `❌ Change request failed: ${result.error}`,
    });
  }
}

/**
 * Handle a resume request detected by Claude
 */
export async function handleResumeRequest(
  client: App["client"],
  userId: string,
  channelId: string,
  messageTs: string,
  messageText: string,
  resumeRequestInfo: ResumeRequestInfo,
  triggerType: TriggerType,
  threadTs?: string
): Promise<void> {
  const effectiveThreadTs = threadTs || messageTs;

  logger.debug(`Resume request from user ${userId} for branch ${resumeRequestInfo.branchName} (trigger: ${triggerType})`);

  // Post acknowledgment message
  const ackMessage = await client.chat.postMessage({
    channel: channelId,
    thread_ts: effectiveThreadTs,
    text: "Resuming previous session...",
  });

  // Read the persisted session state to get the description
  const sessionState = readSessionState(resumeRequestInfo.branchName);
  if (!sessionState) {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `❌ Could not find session state for branch ${resumeRequestInfo.branchName}`,
    });
    return;
  }

  const request: ChangeRequest = {
    userId,
    message: messageText,
    triggerType,
    channel: channelId,
    messageTs,
    threadTs,
  };

  // Reconstruct the plan from persisted state
  const plan: ChangePlan = {
    branchName: sessionState.branch,
    description: sessionState.description,
    targetRepo: sessionState.repo,
  };

  const result = await startChangeWorkflow(
    request,
    plan,
    effectiveThreadTs,
    async (progressMessage: string) => {
      try {
        await client.chat.update({
          channel: channelId,
          ts: ackMessage.ts!,
          text: progressMessage,
        });
      } catch (error) {
        logger.warn("Failed to update progress message:", error);
      }
    }
  );

  if (result.success) {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `✅ PR created: ${result.prUrl}\n\n${result.summary || ""}`.trim(),
    });
  } else {
    await client.chat.update({
      channel: channelId,
      ts: ackMessage.ts!,
      text: `❌ Resume request failed: ${result.error}`,
    });
  }
}
