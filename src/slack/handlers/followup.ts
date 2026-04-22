import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession, appendUserMessage } from "../../sessions.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions } from "../activeSessions.js";
import { executeAndDeliver, getHandlerClaudeOptions } from "./handlerResponse.js";

export interface FollowupDeps {
  getSession: typeof getSession;
  appendUserMessage: typeof appendUserMessage;
  decodeActionValue: typeof decodeActionValue;
  restoreSession: typeof activeSessions.restore;
  executeAndDeliver: typeof executeAndDeliver;
  getHandlerClaudeOptions: typeof getHandlerClaudeOptions;
}

export const defaultFollowupDeps: FollowupDeps = {
  getSession,
  appendUserMessage,
  decodeActionValue,
  restoreSession: activeSessions.restore.bind(activeSessions),
  executeAndDeliver,
  getHandlerClaudeOptions,
};

export function registerFollowupHandler(app: App, deps: FollowupDeps = defaultFollowupDeps): void {
  app.action<BlockAction>(/^clack_followup_\d+$/, async ({ ack, body, client }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, prompt } = deps.decodeActionValue(rawValue);

    if (!prompt) {
      logger.error("Followup handler: missing prompt");
      return;
    }

    const sessionInfo = await deps.restoreSession(sessionId);
    if (!sessionInfo) {
      logger.error(`Followup handler: could not restore session ${sessionId}`);
      return;
    }

    const session = await deps.getSession(sessionId);
    if (!session) {
      logger.error(`Followup handler: session ${sessionId} not found`);
      return;
    }

    // Record the followup press as a structured user message in the conversation log.
    // appendUserMessage dual-writes the prompt text to legacy refinements[] so prompt
    // builder behavior is preserved during the unified-conversation-log transition.
    await deps.appendUserMessage(session.sessionId, {
      role: "user",
      source: "followup",
      text: prompt,
      ts: Date.now(),
    });
    const updatedSession = (await deps.getSession(session.sessionId))!;

    const claudeOptions = await deps.getHandlerClaudeOptions(sessionInfo);
    await deps.executeAndDeliver({
      client,
      session: updatedSession,
      sessionInfo,
      claudeOptions,
    });
  });
}
