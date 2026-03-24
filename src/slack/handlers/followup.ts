import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession, addRefinement } from "../../sessions.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions } from "../activeSessions.js";
import { executeAndDeliver, getHandlerClaudeOptions } from "./handlerResponse.js";

export function registerFollowupHandler(app: App): void {
  app.action<BlockAction>(/^clack_followup_\d+$/, async ({ ack, body, client }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, prompt } = decodeActionValue(rawValue);

    if (!prompt) {
      logger.error("Followup handler: missing prompt");
      return;
    }

    const sessionInfo = await activeSessions.restore(sessionId);
    if (!sessionInfo) {
      logger.error(`Followup handler: could not restore session ${sessionId}`);
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      logger.error(`Followup handler: session ${sessionId} not found`);
      return;
    }

    // Inject the followup prompt as a refinement
    await addRefinement(session.sessionId, prompt);
    const updatedSession = (await getSession(session.sessionId))!;

    const claudeOptions = await getHandlerClaudeOptions(sessionInfo);
    await executeAndDeliver({
      client,
      session: updatedSession,
      sessionInfo,
      claudeOptions,
    });
  });
}
