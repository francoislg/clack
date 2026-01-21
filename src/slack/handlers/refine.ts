import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getSession, addRefinement, setLastAnswer, createSession, parseSessionId, addError } from "../../sessions.js";
import { askClaude, analyzeError } from "../../claude.js";
import { getResponseBlocks, getErrorBlocks, getErrorBlocksWithRetry } from "../blocks.js";
import { restoreSessionInfo, setSessionInfo } from "../state.js";
import { fetchMessage, fetchThreadContext, sendErrorReport } from "../messagesApi.js";
import { transformUserMentions } from "../userCache.js";

export function registerRefineHandler(app: App): void {
  // Handle Refine button - open modal
  app.action<BlockAction>("clack_refine", async ({ ack, body, client, respond }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;

    // Delete the ephemeral message
    await respond({ delete_original: true });

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
                text: "Add specific instructions to improve the answer...",
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
        await client.chat.postEphemeral({
          channel: sessionInfo.channelId,
          user: sessionInfo.userId,
          thread_ts: sessionInfo.threadTs,
          text: "Sorry, the session expired and I couldn't fetch the original message.",
          blocks: getErrorBlocks("Sorry, the session expired and I couldn't fetch the original message."),
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

      // Create new session (note: this creates a NEW sessionId, but we continue using the old one for this request)
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
    }

    // Add refinement and regenerate
    await addRefinement(session.sessionId, refinement);
    const updatedSession = (await getSession(session.sessionId))!;

    const response = await askClaude(updatedSession);

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
      const config = getConfig();
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
  });
}
