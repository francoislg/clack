import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession, addRefinement } from "../../sessions.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions } from "../activeSessions.js";
import { executeAndDeliver, getHandlerClaudeOptions } from "./handlerResponse.js";
import { canRequestChanges } from "../../permissions.js";

export function registerChoiceHandler(app: App): void {
  app.action<BlockAction>(/^clack_choice_\d+$/, async ({ ack, body, client }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, choiceValue, workMode } = decodeActionValue(rawValue);

    if (!choiceValue) {
      logger.error("Choice handler: missing choice value");
      return;
    }

    const sessionInfo = await activeSessions.restore(sessionId);
    if (!sessionInfo) {
      logger.error(`Choice handler: could not restore session ${sessionId}`);
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      logger.error(`Choice handler: session ${sessionId} not found`);
      return;
    }

    // Inject the user's choice as a refinement
    await addRefinement(session.sessionId, `The user chose: ${choiceValue}`);
    const updatedSession = (await getSession(session.sessionId))!;

    const claudeOptions = await getHandlerClaudeOptions(sessionInfo);
    const effectiveWorkMode =
      workMode &&
      claudeOptions.changesWorkflowEnabled &&
      canRequestChanges(claudeOptions.role ?? "member");

    await executeAndDeliver({
      client,
      session: updatedSession,
      sessionInfo,
      claudeOptions: { ...claudeOptions, workMode: effectiveWorkMode || false },
    });
  });
}
