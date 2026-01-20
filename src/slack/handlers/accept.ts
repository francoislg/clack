import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession, touchSession } from "../../sessions.js";
import { getAcceptedBlocks } from "../blocks.js";
import { restoreSessionInfo, deleteSessionInfo } from "../state.js";

/**
 * Extract the answer text from the ephemeral message blocks.
 * The answer is in the first section block's text.
 */
function extractAnswerFromMessage(body: BlockAction): string | null {
  try {
    const message = body.message;
    if (!message || !message.blocks || !Array.isArray(message.blocks)) {
      return null;
    }

    // Find the first section block with text
    for (const block of message.blocks) {
      if (block.type === "section" && block.text?.text) {
        return block.text.text;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function registerAcceptHandler(app: App): void {
  app.action<BlockAction>("clack_accept", async ({ ack, body, client, respond }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    const sessionInfo = await restoreSessionInfo(sessionId);
    const session = await getSession(sessionId);

    // Try to get answer from session, or extract from message blocks (for expired sessions)
    const answer = session?.lastAnswer || extractAnswerFromMessage(body);

    if (sessionInfo && answer) {
      // Delete the ephemeral message
      await respond({ delete_original: true });

      // Post public message with the answer (visible to everyone)
      await client.chat.postMessage({
        channel: sessionInfo.channelId,
        thread_ts: sessionInfo.threadTs,
        blocks: getAcceptedBlocks(answer),
        text: answer,
        unfurl_links: false,
        unfurl_media: false,
      });

      deleteSessionInfo(sessionId);
      if (session) {
        await touchSession(sessionId);
      }
      logger.debug(`Accepted answer for session ${sessionId}`);
    } else {
      logger.error(`Cannot accept: sessionInfo=${!!sessionInfo}, answer=${!!answer}`);
    }
  });
}
