import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession } from "../../sessions.js";
import { getStructuredResponseBlocks, asSlackBlocks } from "../blocks.js";
import { activeSessions } from "../activeSessions.js";
import { postResponse } from "./handlerResponse.js";

export interface ResendDeps {
  getSession: typeof getSession;
  restoreSession: typeof activeSessions.restore;
  postResponse: typeof postResponse;
  getStructuredResponseBlocks: typeof getStructuredResponseBlocks;
  asSlackBlocks: typeof asSlackBlocks;
}

export const defaultResendDeps: ResendDeps = {
  getSession,
  restoreSession: activeSessions.restore.bind(activeSessions),
  postResponse,
  getStructuredResponseBlocks,
  asSlackBlocks,
};

export function registerResendHandler(app: App, deps: ResendDeps = defaultResendDeps): void {
  app.action<BlockAction>("clack_resend", async ({ ack, body, client, respond }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    const session = await deps.getSession(sessionId);
    const sessionInfo = await deps.restoreSession(sessionId);

    if (!session || !sessionInfo || !session.lastAnswer) {
      logger.error("Could not restore session for resend");
      await respond({
        text: "Sorry, the session has expired. Please start a new query.",
        replace_original: true,
      });
      return;
    }

    if (session.lastResponse) {
      const blocks = deps.getStructuredResponseBlocks(session.lastResponse, session.sessionId);
      await deps.postResponse(client, sessionInfo, {
        blocks: deps.asSlackBlocks(blocks),
        text: session.lastAnswer,
      });
    } else {
      await deps.postResponse(client, sessionInfo, {
        text: session.lastAnswer,
      });
    }

    await client.chat.postMessage({
      channel: body.channel!.id,
      text: "The message was sent again.",
    });
  });
}
