import type { App, BlockAction } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import {
  getSession,
  updateThreadContext,
  setLastAnswer,
  addError,
} from "../../sessions.js";
import { askClaude, analyzeError } from "../../claude.js";
import { getResponseBlocks, getErrorBlocksWithRetry } from "../blocks.js";
import { restoreSessionInfo } from "../state.js";
import { fetchThreadContext, sendErrorReport } from "../messagesApi.js";

export function registerRetryHandler(app: App): void {
  app.action<BlockAction>(
    "clack_retry",
    async ({ ack, body, client, respond }) => {
      await ack();

      const sessionId = (body.actions[0] as { value: string }).value;
      let session = await getSession(sessionId);
      const sessionInfo = await restoreSessionInfo(sessionId);

      if (!session || !sessionInfo) {
        logger.error("Could not restore session for retry");
        await respond({
          text: "Sorry, the session has expired. Please start a new query.",
          replace_original: true,
        });
        return;
      }

      // Delete the error message
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

      // Update session with fresh thread context
      await updateThreadContext(session.sessionId, threadContext);
      session = (await getSession(session.sessionId))!;

      // Show thinking feedback
      await client.chat.postEphemeral({
        channel: sessionInfo.channelId,
        user: sessionInfo.userId,
        thread_ts: sessionInfo.threadTs,
        text: "Retrying...",
      });

      // Ask Claude again
      logger.info(`Retrying Claude Code (session: ${session.sessionId})...`);
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
        logger.error("Claude Code retry failed:", response.error);

        const errorMessage = response.error || "Unknown error";
        const conversationTrace = response.conversationTrace || [];

        // Store the error in the session
        await addError(session.sessionId, errorMessage, conversationTrace);

        // Show user-friendly error with retry button
        await client.chat.postEphemeral({
          channel: sessionInfo.channelId,
          user: sessionInfo.userId,
          thread_ts: sessionInfo.threadTs,
          text: "Claude seems to have crashed, maybe try again?",
          blocks: getErrorBlocksWithRetry(session.sessionId),
        });

        // Send detailed error report via DM if enabled
        if (config.slack.sendErrorsAsDM) {
          try {
            const analysis = await analyzeError(errorMessage, conversationTrace);
            await sendErrorReport(client, sessionInfo.userId, {
              sessionId: session.sessionId,
              errorMessage,
              conversationTrace,
              analysis,
            });
          } catch (dmError) {
            logger.error("Failed to send error report DM:", dmError);
          }
        }
      }
    }
  );
}
