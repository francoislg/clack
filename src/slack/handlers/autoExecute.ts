/**
 * Auto-execute logic for actions flagged with `auto: true`.
 * Extracted from core.ts so it can be shared by processMessage and button handlers.
 */
import type { App } from "@slack/bolt";
import type { ClaudeResponse } from "../../claude.js";
import type { ChangeSession } from "../../changes/types.js";
import type { StagedChangeIntent, StagedIntent, Action } from "../../tools/types.js";
import type { UserRole } from "../../roles.js";
import { canRequestChanges } from "../../permissions.js";
import { triggerChangeWorkflow } from "./changeAction.js";
import { triggerFollowUp } from "./changeThreadActions.js";
import { logger } from "../../logger.js";

export interface AutoExecuteParams {
  client: App["client"];
  channelId: string;
  threadTs: string;
  userId: string;
  response: ClaudeResponse;
  changeSession: ChangeSession | undefined;
  role: UserRole;
}

/**
 * Check for auto-flagged actions in the response and trigger them immediately.
 * Runs after the response is posted to Slack. Errors are caught and posted
 * to the thread without affecting the already-posted response.
 */
export async function handleAutoExecuteActions(params: AutoExecuteParams): Promise<void> {
  const { client, channelId, threadTs, userId, response, changeSession, role } = params;

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
      if (action.type === "change" && intent.type === "change") {
        logger.info(`Auto-executing change action: ${(intent as StagedChangeIntent).description}`);
        // Fire and forget — triggerChangeWorkflow manages its own progress messages
        triggerChangeWorkflow(
          intent as StagedChangeIntent,
          channelId,
          threadTs,
          userId,
          client
        ).catch((err) => {
          logger.error("Auto-execute change workflow error:", err);
          client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `Auto-execute failed: ${err instanceof Error ? err.message : String(err)}`,
          }).catch(() => {});
        });
      } else if (
        (action.type === "update" || action.type === "review" || action.type === "merge" || action.type === "close") &&
        changeSession
      ) {
        const additionalInstructions = action.type === "update" && "instructions" in intent
          ? (intent as { instructions: string }).instructions
          : undefined;

        logger.info(`Auto-executing ${action.type} follow-up action`);
        // Fire and forget — triggerFollowUp manages its own progress messages
        triggerFollowUp(
          changeSession,
          action.type,
          additionalInstructions,
          channelId,
          threadTs,
          client
        ).catch((err) => {
          logger.error(`Auto-execute ${action.type} follow-up error:`, err);
          client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `Auto-execute failed: ${err instanceof Error ? err.message : String(err)}`,
          }).catch(() => {});
        });
      } else {
        logger.warn(`Auto-execute: unsupported action type ${action.type} or missing change session`);
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
