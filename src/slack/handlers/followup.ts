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

export function registerFollowupHandler(app: App): void {
  app.action<BlockAction>(/^clack_followup_\d+$/, async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, prompt } = decodeActionValue(rawValue);

    if (!prompt) {
      logger.error("Followup handler: missing prompt");
      return;
    }

    const sessionInfo = await restoreSessionInfo(sessionId);
    if (!sessionInfo) {
      logger.error(`Followup handler: could not restore session ${sessionId}`);
      return;
    }

    await dismissOriginal(respond, sessionInfo);

    const session = await getSession(sessionId);
    if (!session) {
      logger.error(`Followup handler: session ${sessionId} not found`);
      return;
    }

    // Inject the followup prompt as a refinement
    await addRefinement(session.sessionId, prompt);
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
