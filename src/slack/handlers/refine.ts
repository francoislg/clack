import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getSession, addRefinement, createSession, parseSessionId } from "../../sessions.js";
import { askClaude } from "../../claude.js";
import { getErrorBlocks, decodeActionValue } from "../blocks.js";
import { restoreSessionInfo, setSessionInfo } from "../state.js";
import { fetchMessage, fetchThreadContext } from "../messagesApi.js";
import { transformUserMentions } from "../userCache.js";
import {
  dismissOriginal,
  postResponse,
  postSuccessResponseWithRetry,
  postErrorResponse,
  getHandlerClaudeOptions,
} from "./handlerResponse.js";

export function registerRefineHandler(app: App): void {
  // Handle Refine button - open modal
  app.action<BlockAction>("clack_refine", async ({ ack, body, client, respond }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const decoded = decodeActionValue(rawValue);
    const sessionId = decoded.sessionId;
    const hint = decoded.hint;

    const sessionInfo = await restoreSessionInfo(sessionId);
    await dismissOriginal(respond, sessionInfo ?? { isEphemeral: true } as any);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "clack_refine_modal",
        private_metadata: sessionId,
        title: {
          type: "plain_text",
          text: "Refine Answer",
        },
        submit: {
          type: "plain_text",
          text: "Submit",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
            type: "input",
            block_id: "refinement_block",
            element: {
              type: "plain_text_input",
              action_id: "refinement_input",
              multiline: true,
              placeholder: {
                type: "plain_text",
                text: hint || "Add specific instructions to improve the answer...",
              },
            },
            label: {
              type: "plain_text",
              text: "Additional Instructions",
            },
          },
        ],
      },
    });
  });

  // Handle Refine modal submission
  app.view<ViewSubmitAction>("clack_refine_modal", async ({ ack, view, client }) => {
    await ack();

    const sessionId = view.private_metadata;
    const refinement = view.state.values.refinement_block.refinement_input.value || "";

    let session = await getSession(sessionId);
    const sessionInfo = await restoreSessionInfo(sessionId);

    if (!sessionInfo) {
      logger.error("Could not restore session info for refinement");
      return;
    }

    // If session doesn't exist on disk, recreate it from Slack context
    if (!session) {
      logger.debug(`Session ${sessionId} expired, recreating from Slack context`);

      const parsed = parseSessionId(sessionId);
      if (!parsed) {
        logger.error("Failed to parse sessionId for recreation");
        return;
      }

      // Fetch original message and thread context from Slack
      const messageText = await fetchMessage(client, parsed.channelId, parsed.messageTs, sessionInfo.threadTs);
      if (!messageText) {
        logger.error("Could not fetch original message for session recreation");
        await postResponse(client, sessionInfo, {
          blocks: getErrorBlocks("Sorry, the session expired and I couldn't fetch the original message.") as unknown[],
          text: "Sorry, the session expired and I couldn't fetch the original message.",
        });
        return;
      }

      // Get bot user ID for thread context attribution
      const botUserId = (await client.auth.test()).user_id || "";
      const config = getConfig();
      const threadContext = await fetchThreadContext(client, parsed.channelId, sessionInfo.threadTs, botUserId, {
        fetchUserNames: config.slack.fetchAndStoreUsername,
      });

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
        isEphemeral: sessionInfo.isEphemeral,
        triggerType: sessionInfo.triggerType,
      });

      logger.debug(`Recreated session as ${session.sessionId}`);
    }

    // Add refinement and regenerate
    await addRefinement(session.sessionId, refinement);
    const updatedSession = (await getSession(session.sessionId))!;

    const claudeOptions = await getHandlerClaudeOptions(sessionInfo);
    const response = await askClaude(updatedSession, claudeOptions);

    if (response.success) {
      await postSuccessResponseWithRetry(client, sessionInfo, session.sessionId, response);
    } else {
      await postErrorResponse(client, sessionInfo, session.sessionId, response);
    }
  });
}
