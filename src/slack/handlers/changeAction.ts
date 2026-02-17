import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession } from "../../sessions.js";
import { decodeActionValue } from "../blocks.js";
import { restoreSessionInfo } from "../state.js";
import type { StagedChangeIntent } from "../../tools/types.js";
import type { ChangeRequest, ChangePlan } from "../../changes/types.js";
import { startChangeWorkflow } from "../../changes/workflow.js";

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

export function registerChangeActionHandler(app: App): void {
  app.action<BlockAction>("clack_change", async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, ref } = decodeActionValue(rawValue);
    const userId = body.user.id;

    if (!ref) {
      logger.error("Change action handler: missing ref");
      return;
    }

    // Delete the ephemeral message
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

    // Post acknowledgment
    const ackMessage = await client.chat.postMessage({
      channel: sessionInfo.channelId,
      thread_ts: sessionInfo.threadTs,
      text: `Starting change: ${intent.description}`,
    });

    // Build change request and plan
    const request: ChangeRequest = {
      userId,
      message: intent.description,
      triggerType: "reactions",
      channel: sessionInfo.channelId,
      messageTs: sessionInfo.threadTs,
    };

    const plan: ChangePlan = {
      branchName: intent.branch,
      description: intent.description,
      targetRepo: intent.repo,
    };

    const result = await startChangeWorkflow(
      request,
      plan,
      sessionInfo.threadTs,
      async (progressMessage: string) => {
        try {
          await client.chat.update({
            channel: sessionInfo.channelId,
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
        channel: sessionInfo.channelId,
        ts: ackMessage.ts!,
        text: `PR created: ${result.prUrl}\n\n${result.summary || ""}`.trim(),
      });
    } else {
      await client.chat.update({
        channel: sessionInfo.channelId,
        ts: ackMessage.ts!,
        text: `Change request failed: ${result.error}`,
      });
    }
  });
}
