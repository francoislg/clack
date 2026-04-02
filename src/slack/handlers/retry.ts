import type { App, BlockAction } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getSession, updateThreadContext } from "../../sessions.js";
import { activeSessions } from "../activeSessions.js";
import { fetchThreadContext } from "../messagesApi.js";
import { executeAndDeliver, getHandlerClaudeOptions } from "./handlerResponse.js";

export function registerRetryHandler(app: App): void {
  app.action<BlockAction>("clack_retry", async ({ ack, body, client, respond }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    let session = await getSession(sessionId);
    const sessionInfo = await activeSessions.restore(sessionId);

    if (!session || !sessionInfo) {
      logger.error("Could not restore session for retry");
      await respond({
        text: "Sorry, the session has expired. Please start a new query.",
        replace_original: true,
      });
      return;
    }

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
      },
    );

    // Update session with fresh thread context
    await updateThreadContext(session.sessionId, threadContext);
    session = (await getSession(session.sessionId))!;

    // Delegate to executeAndDeliver — streaming replaces "Retrying..." text
    logger.info(`Retrying Claude Code (session: ${session.sessionId})...`);
    const claudeOptions = await getHandlerClaudeOptions(sessionInfo);
    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions,
    });
  });
}
