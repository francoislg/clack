import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession } from "../../sessions.js";
import { getStructuredResponseBlocks, asSlackBlocks } from "../blocks.js";
import { restoreSessionInfo } from "../state.js";
import { postResponse } from "./handlerResponse.js";

export function registerResendHandler(app: App): void {
  app.action<BlockAction>(
    "clack_resend",
    async ({ ack, body, client, respond }) => {
      await ack();

      const sessionId = (body.actions[0] as { value: string }).value;
      const session = await getSession(sessionId);
      const sessionInfo = await restoreSessionInfo(sessionId);

      if (!session || !sessionInfo || !session.lastAnswer) {
        logger.error("Could not restore session for resend");
        await respond({
          text: "Sorry, the session has expired. Please start a new query.",
          replace_original: true,
        });
        return;
      }

      if (session.lastResponse) {
        const blocks = getStructuredResponseBlocks(session.lastResponse, session.sessionId);
        await postResponse(client, sessionInfo, {
          blocks: asSlackBlocks(blocks),
          text: session.lastAnswer,
        });
      } else {
        await postResponse(client, sessionInfo, {
          text: session.lastAnswer,
        });
      }

      await client.chat.postMessage({
        channel: body.channel!.id,
        text: "The message was sent again.",
      });
    }
  );
}
