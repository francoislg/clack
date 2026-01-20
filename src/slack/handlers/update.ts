import type { App, BlockAction } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import {
  getSession,
  updateThreadContext,
  setLastAnswer,
  createSession,
  parseSessionId,
} from "../../sessions.js";
import { askClaude } from "../../claude.js";
import { getResponseBlocks, getErrorBlocks } from "../blocks.js";
import { restoreSessionInfo, setSessionInfo } from "../state.js";
import { fetchMessage, fetchThreadContext } from "../messagesApi.js";
import { transformUserMentions } from "../userCache.js";

export function registerUpdateHandler(app: App): void {
  app.action<BlockAction>(
    "clack_update",
    async ({ ack, body, client, respond }) => {
      await ack();

      const sessionId = (body.actions[0] as { value: string }).value;
      let session = await getSession(sessionId);
      const sessionInfo = await restoreSessionInfo(sessionId);

      if (!sessionInfo) {
        logger.error("Could not restore session info for update");
        return;
      }

      // Delete the ephemeral message
      await respond({ delete_original: true });

      // Get bot user ID for thread context attribution
      const botUserId = (await client.auth.test()).user_id || "";

      const config = getConfig();

      // Re-fetch thread context
      const threadContext = await fetchThreadContext(
        client,
        sessionInfo.channelId,
        sessionInfo.threadTs,
        botUserId,
        {
          fetchUserNames: config.slack.fetchAndStoreUsername,
        }
      );

      // If session doesn't exist on disk, recreate it from Slack context
      if (!session) {
        logger.debug(
          `Session ${sessionId} expired, recreating from Slack context`
        );

        const parsed = parseSessionId(sessionId);
        if (!parsed) {
          logger.error("Failed to parse sessionId for recreation");
          return;
        }

        // Fetch original message from Slack
        const messageText = await fetchMessage(
          client,
          parsed.channelId,
          parsed.messageTs,
          sessionInfo.threadTs
        );
        if (!messageText) {
          logger.error(
            "Could not fetch original message for session recreation"
          );
          await client.chat.postEphemeral({
            channel: sessionInfo.channelId,
            user: sessionInfo.userId,
            thread_ts: sessionInfo.threadTs,
            text: "Sorry, the session expired and I couldn't fetch the original message.",
            blocks: getErrorBlocks(
              "Sorry, the session expired and I couldn't fetch the original message."
            ),
          });
          return;
        }

        // Transform user mentions in message text if enabled
        const processedMessageText = config.slack.fetchAndStoreUsername
          ? await transformUserMentions(client, messageText)
          : messageText;

        // Create new session
        session = await createSession(
          parsed.channelId,
          parsed.messageTs,
          sessionInfo.threadTs,
          parsed.userId,
          processedMessageText,
          threadContext
        );

        // Update sessionInfo to point to the new session
        setSessionInfo(session.sessionId, {
          channelId: session.channelId,
          threadTs: session.threadTs,
          userId: session.userId,
        });

        logger.debug(`Recreated session as ${session.sessionId}`);
      } else {
        // Update existing session with fresh thread context
        await updateThreadContext(session.sessionId, threadContext);
        session = (await getSession(session.sessionId))!;
      }

      const response = await askClaude(session);

      if (response.success) {
        await setLastAnswer(session.sessionId, response.answer);

        await client.chat.postEphemeral({
          channel: sessionInfo.channelId,
          user: sessionInfo.userId,
          thread_ts: sessionInfo.threadTs,
          blocks: getResponseBlocks(response.answer, session.sessionId),
          text: response.answer,
        });
      } else {
        await client.chat.postEphemeral({
          channel: sessionInfo.channelId,
          user: sessionInfo.userId,
          thread_ts: sessionInfo.threadTs,
          text: `Sorry, I couldn't update the answer: ${
            response.error || "Unknown error"
          }`,
          blocks: getErrorBlocks(
            `Sorry, I couldn't update the answer: ${
              response.error || "Unknown error"
            }`
          ),
        });
      }
    }
  );
}
