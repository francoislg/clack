import type { App, BlockAction } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import {
  getSession,
  updateThreadContext,
} from "../../sessions.js";
import { askClaude } from "../../claude.js";
import { restoreSessionInfo } from "../state.js";
import { fetchThreadContext } from "../messagesApi.js";
import {
  dismissOriginal,
  postResponse,
  postSuccessResponseWithRetry,
  postErrorResponse,
  getHandlerClaudeOptions,
} from "./handlerResponse.js";

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

      await dismissOriginal(respond, sessionInfo);

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
      await postResponse(client, sessionInfo, { text: "Retrying..." });

      // Ask Claude again
      logger.info(`Retrying Claude Code (session: ${session.sessionId})...`);
      const claudeOptions = await getHandlerClaudeOptions(sessionInfo);
      const response = await askClaude(session, claudeOptions);

      if (response.success) {
        await postSuccessResponseWithRetry(client, sessionInfo, session.sessionId, response);
      } else {
        logger.error("Claude Code retry failed:", response.error);
        await postErrorResponse(client, sessionInfo, session.sessionId, response);
      }
    }
  );
}
