/**
 * Auto-execute logic for actions flagged with `auto: true`.
 * Extracted from core.ts so it can be shared by processMessage and button handlers.
 */
import type { App } from "@slack/bolt";
import { errorMessage } from "../../errors.js";
import type { ClaudeResponse } from "../../claude/index.js";
import type { Action, PostToAction } from "../../tools/types.js";
import type { UserRole } from "../../roles.js";
import type { TriggerType } from "../../changes/types.js";
import { canRequestChanges } from "../../permissions.js";
import { triggerChangeWorkflow } from "./changeAction.js";
import { triggerFollowUp } from "./changeThreadActions.js";
import { postAnswerToChannel, resolveOrigin } from "./dmActions.js";
import { writeInstructionFile } from "../../configurationFiles.js";
import { findSessionByThread, getSession } from "../../sessions.js";
import { activeSessions } from "../activeSessions.js";
import { logger } from "../../logger.js";

export interface AutoExecuteParams {
  client: App["client"];
  channelId: string;
  threadTs: string;
  userId: string;
  response: ClaudeResponse;
  /** Unified session ID for looking up active change state */
  sessionId: string;
  role: UserRole;
  /** When set, stream progress to this DM thread instead of the channel thread. */
  dmChannel?: string;
  dmThreadTs?: string;
  /** Original trigger type, propagated to change workflow. */
  triggerType?: TriggerType;
}

/**
 * Check for auto-flagged actions in the response and trigger them immediately.
 * Runs after the response is posted to Slack. Errors are caught and posted
 * to the thread without affecting the already-posted response.
 */
export async function handleAutoExecuteActions(params: AutoExecuteParams): Promise<void> {
  const { client, channelId, threadTs, userId, response, sessionId, role, dmChannel, dmThreadTs, triggerType } = params;

  if (!response.response?.actions) return;

  // Handle post_to auto-execute first — available to all roles, not intent-based
  await handlePostToAutoExecute(params);

  if (!response.stagedIntents) return;

  if (!canRequestChanges(role)) {
    logger.warn(`Auto-execute blocked for non-privileged role "${role}"`);
    return;
  }

  // Filter to actions that have both `auto: true` and a `ref`
  type AutoAction = Action & { auto: true; ref: string };
  const autoActions = response.response.actions.filter(
    (a: Action): a is AutoAction =>
      "auto" in a && (a as unknown as { auto: boolean }).auto === true && "ref" in a
  );
  if (autoActions.length === 0) return;

  for (const action of autoActions) {
    const intent = response.stagedIntents[action.ref];
    if (!intent) {
      logger.warn(`Auto-execute: could not resolve intent for ref ${action.ref}`);
      continue;
    }

    try {
      switch (intent.type) {
        case "config_update": {
          logger.info(`Auto-executing config update: ${intent.file}`);
          try {
            writeInstructionFile(intent.file, intent.content);
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: `Configuration file \`${intent.file}\` has been updated.`,
            });
          } catch (err) {
            logger.error("Auto-execute config update error:", err);
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: `Failed to update \`${intent.file}\`: ${errorMessage(err)}`,
            }).catch(() => {});
          }
          break;
        }

        case "change": {
          logger.info(`Auto-executing change action: ${intent.description}`);
          await triggerChangeWorkflow(intent, {
            channelId,
            threadTs,
            userId,
            client,
            ...(dmChannel && dmThreadTs ? { streamChannel: dmChannel, streamThreadTs: dmThreadTs } : {}),
            triggerType,
          });
          break;
        }

        case "update": {
          const session = await findSessionByThread(channelId, threadTs);
          if (!session?.activeChange) {
            logger.warn(`Auto-execute update: no active change found in thread`);
            continue;
          }

          logger.info(`Auto-executing update follow-up action`);
          await triggerFollowUp(session, "update", intent.instructions, {
            channelId,
            threadTs,
            userId,
            client,
            ...(dmChannel && dmThreadTs ? { streamChannel: dmChannel, streamThreadTs: dmThreadTs } : {}),
          });
          break;
        }

        default: {
          const _exhaustive: never = intent;
          logger.warn(`Auto-execute: unsupported intent type ${(_exhaustive as { type: string }).type}`);
        }
      }
    } catch (error) {
      logger.error(`Auto-execute error for action type ${action.type}:`, error);
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Auto-execute failed: ${errorMessage(error)}`,
        });
      } catch {
        // Best effort — don't let error reporting crash the flow
      }
    }
  }
}

/**
 * Auto-execute post_to actions. Runs before intent-based auto-execute
 * because post_to is snapshot-based (not intent-based) and available to all roles.
 */
async function handlePostToAutoExecute(params: AutoExecuteParams): Promise<void> {
  const { client, channelId, threadTs, response, sessionId, triggerType } = params;

  if (!response.response?.actions) return;

  const postToActions = response.response.actions.filter(
    (a: Action): a is PostToAction =>
      a.type === "post_to" && a.auto === true
  );
  if (postToActions.length === 0) return;

  const session = await getSession(sessionId);
  if (!session) {
    logger.warn(`post_to auto-execute: session ${sessionId} not found`);
    return;
  }

  const sessionInfo = await activeSessions.restore(sessionId);

  for (const action of postToActions) {
    const snapshot = action._snapshotId
      ? session.snapshots?.[action._snapshotId]
      : undefined;

    if (!snapshot) {
      logger.warn(`post_to auto-execute: missing snapshot for session ${sessionId} (snapshotId: ${action._snapshotId ?? "none"})`);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "Could not auto-post: response content was not found.",
      }).catch(() => {});
      continue;
    }

    // Resolve target via fallback chain: explicit → origin → assistant → session channel
    const origin = sessionInfo
      ? resolveOrigin(session, sessionInfo)
      : { originChannel: undefined, originThreadTs: undefined };

    const targetChannel = action.channel
      || origin.originChannel
      || session.assistantCurrentChannelId
      || channelId;
    const targetThreadTs = action.thread_ts
      || origin.originThreadTs
      || undefined;

    if (!targetChannel) {
      logger.warn(`post_to auto-execute: no target channel for session ${sessionId}`);
      continue;
    }

    try {
      logger.info(`Auto-executing post_to: channel=${targetChannel}, thread=${targetThreadTs ?? "(top-level)"}`);
      await postAnswerToChannel(client, snapshot, targetChannel, targetThreadTs);
    } catch (error) {
      logger.error("post_to auto-execute failed:", error);
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Failed to post: ${errorMessage(error)}`,
        });
      } catch {
        // Best effort
      }
    }
  }
}
