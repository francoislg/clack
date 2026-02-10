import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession } from "../../sessions.js";
import { getResponseBlocks } from "../blocks.js";
import { restoreSessionInfo } from "../state.js";

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

      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: sessionInfo.userId,
        thread_ts: sessionInfo.threadTs,
        blocks: getResponseBlocks(session.lastAnswer, session.sessionId),
        text: session.lastAnswer,
      });

      await respond({
        text: "The answer has been resent to the thread.",
        replace_original: true,
      });
    }
  );
}
