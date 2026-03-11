/**
 * Auto-execute logic for actions flagged with `auto: true`.
 * Extracted from core.ts so it can be shared by processMessage and button handlers.
 */
import type { App } from "@slack/bolt";
import type { ClaudeResponse } from "../../claude.js";
import type { StagedChangeIntent, StagedConfigUpdateIntent, StagedIntent, Action } from "../../tools/types.js";
import type { UserRole } from "../../roles.js";
import { canRequestChanges } from "../../permissions.js";
import { triggerChangeWorkflow } from "./changeAction.js";
import { triggerFollowUp } from "./changeThreadActions.js";
import { writeInstructionFile } from "../../configurationFiles.js";
import { findSessionByThread } from "../../sessions.js";
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
}

/**
 * Check for auto-flagged actions in the response and trigger them immediately.
 * Runs after the response is posted to Slack. Errors are caught and posted
 * to the thread without affecting the already-posted response.
 */
export async function handleAutoExecuteActions(params: AutoExecuteParams): Promise<void> {
  const { client, channelId, threadTs, userId, response, sessionId, role, dmChannel, dmThreadTs } = params;

  if (!response.response?.actions || !response.stagedIntents) return;

  if (!canRequestChanges(role)) {
    logger.warn(`Auto-execute blocked for non-privileged role "${role}"`);
    return;
  }

  const autoActions = response.response.actions.filter(
    (a: Action) => "auto" in a && (a as { auto?: boolean }).auto === true && "ref" in a
  );
  if (autoActions.length === 0) return;

  for (const action of autoActions) {
    const ref = (action as { ref: string }).ref;
    const intent = response.stagedIntents[ref] as StagedIntent | undefined;
    if (!intent) {
      logger.warn(`Auto-execute: could not resolve intent for ref ${ref}`);
      continue;
    }

    try {
      if (action.type === "config_update" && intent.type === "config_update") {
        const configIntent = intent as StagedConfigUpdateIntent;
        logger.info(`Auto-executing config update: ${configIntent.file}`);
        try {
          writeInstructionFile(configIntent.file, configIntent.content);
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `Configuration file \`${configIntent.file}\` has been updated.`,
          });
        } catch (err) {
          logger.error("Auto-execute config update error:", err);
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `Failed to update \`${configIntent.file}\`: ${err instanceof Error ? err.message : String(err)}`,
          }).catch(() => {});
        }
      } else if (action.type === "change" && intent.type === "change") {
        logger.info(`Auto-executing change action: ${(intent as StagedChangeIntent).description}`);
        await triggerChangeWorkflow(
          intent as StagedChangeIntent,
          channelId,
          threadTs,
          userId,
          client,
          dmChannel && dmThreadTs ? { streamChannel: dmChannel, streamThreadTs: dmThreadTs } : undefined,
        );
      } else if (action.type === "update") {
        // Look up the unified session to find active change
        const session = await findSessionByThread(channelId, threadTs);
        if (!session?.activeChange) {
          logger.warn(`Auto-execute update: no active change found in thread`);
          continue;
        }

        const additionalInstructions = "instructions" in intent
          ? (intent as { instructions: string }).instructions
          : undefined;

        logger.info(`Auto-executing update follow-up action`);
        await triggerFollowUp(
          session,
          "update",
          additionalInstructions,
          channelId,
          threadTs,
          userId,
          client,
          dmChannel && dmThreadTs ? { streamChannel: dmChannel, streamThreadTs: dmThreadTs } : undefined,
        );
      } else {
        logger.warn(`Auto-execute: unsupported action type ${action.type}`);
      }
    } catch (error) {
      logger.error(`Auto-execute error for action type ${action.type}:`, error);
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Auto-execute failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      } catch {
        // Best effort — don't let error reporting crash the flow
      }
    }
  }
}
