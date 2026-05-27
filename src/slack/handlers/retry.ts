import type { App, BlockAction } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getSession, updateThreadContext } from "../../sessions.js";
import { activeSessions } from "../activeSessions.js";
import { fetchThreadContext } from "../messagesApi.js";
import { executeAndDeliver, getHandlerClaudeOptions } from "./handlerResponse.js";
import { t } from "../../i18n/t.js";

export interface RetryDeps {
  getSession: typeof getSession;
  updateThreadContext: typeof updateThreadContext;
  restoreSession: typeof activeSessions.restore;
  fetchThreadContext: typeof fetchThreadContext;
  executeAndDeliver: typeof executeAndDeliver;
  getHandlerClaudeOptions: typeof getHandlerClaudeOptions;
  getConfig: typeof getConfig;
}

export const defaultRetryDeps: RetryDeps = {
  getSession,
  updateThreadContext,
  restoreSession: activeSessions.restore.bind(activeSessions),
  fetchThreadContext,
  executeAndDeliver,
  getHandlerClaudeOptions,
  getConfig,
};

export function registerRetryHandler(app: App, deps: RetryDeps = defaultRetryDeps): void {
  app.action<BlockAction>("clack_retry", async ({ ack, body, client, respond }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    let session = await deps.getSession(sessionId);
    const sessionInfo = await deps.restoreSession(sessionId);

    if (!session || !sessionInfo) {
      logger.error("Could not restore session for retry");
      await respond({
        text: t("errors.session_expired"),
        replace_original: true,
      });
      return;
    }

    // Get bot user ID for thread context attribution
    const botUserId = (await client.auth.test()).user_id || "";
    const config = deps.getConfig();

    // Re-fetch thread context
    const threadContext = await deps.fetchThreadContext(
      client,
      sessionInfo.channelId,
      sessionInfo.threadTs,
      botUserId,
      {
        fetchUserNames: config.slack.fetchAndStoreUsername,
      },
    );

    // Update session with fresh thread context
    await deps.updateThreadContext(session.sessionId, threadContext);
    session = (await deps.getSession(session.sessionId))!;

    // Delegate to executeAndDeliver — streaming replaces "Retrying..." text
    logger.info(`Retrying Claude Code (session: ${session.sessionId})...`);
    const claudeOptions = await deps.getHandlerClaudeOptions(sessionInfo);
    await deps.executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions,
    });
  });
}
