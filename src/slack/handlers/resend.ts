import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { t } from "../../i18n/t.js";
import { getSession } from "../../sessions.js";
import { latestAssistantText, latestAssistantPayload } from "../../sessions/selectors.js";
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

    const answerText = session ? latestAssistantText(session) : undefined;
    const answerPayload = session ? latestAssistantPayload(session) : undefined;

    if (!session || !sessionInfo || !answerText) {
      logger.error("Could not restore session for resend");
      await respond({
        text: t("errors.session_expired"),
        replace_original: true,
      });
      return;
    }

    if (answerPayload) {
      const blocks = deps.getStructuredResponseBlocks(answerPayload, session.sessionId);
      await deps.postResponse(client, sessionInfo, {
        blocks: deps.asSlackBlocks(blocks),
        text: answerText,
      });
    } else {
      await deps.postResponse(client, sessionInfo, {
        text: answerText,
      });
    }

    await client.chat.postMessage({
      channel: body.channel!.id,
      text: t("errors.resend_sent"),
    });
  });
}
