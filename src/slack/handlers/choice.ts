import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession, addRefinement } from "../../sessions.js";
import { askClaude } from "../../claude.js";
import { decodeActionValue } from "../blocks.js";
import { restoreSessionInfo } from "../state.js";
import {
  dismissOriginal,
  postSuccessResponseWithRetry,
  postErrorResponse,
  getHandlerClaudeOptions,
} from "./handlerResponse.js";

export function registerChoiceHandler(app: App): void {
  app.action<BlockAction>("clack_choice", async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, choiceValue } = decodeActionValue(rawValue);

    if (!choiceValue) {
      logger.error("Choice handler: missing choice value");
      return;
    }

    const sessionInfo = await restoreSessionInfo(sessionId);
    if (!sessionInfo) {
      logger.error(`Choice handler: could not restore session ${sessionId}`);
      return;
    }

    await dismissOriginal(respond, sessionInfo);

    const session = await getSession(sessionId);
    if (!session) {
      logger.error(`Choice handler: session ${sessionId} not found`);
      return;
    }

    // Inject the user's choice as a refinement
    await addRefinement(session.sessionId, `The user chose: ${choiceValue}`);
    const updatedSession = (await getSession(session.sessionId))!;

    const claudeOptions = await getHandlerClaudeOptions(sessionInfo);
    const response = await askClaude(updatedSession, claudeOptions);

    if (response.success) {
      await postSuccessResponseWithRetry(client, sessionInfo, session.sessionId, response);
    } else {
      await postErrorResponse(client, sessionInfo, session.sessionId, response);
    }
  });
}
