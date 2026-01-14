import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { getSession, addRefinement, setLastAnswer, createSession, parseSessionId } from "../../sessions.js";
import { askClaude } from "../../claude.js";
import { getResponseBlocks, getErrorBlocks } from "../blocks.js";
import { restoreSessionInfo, setSessionInfo } from "../state.js";
import { fetchMessage, fetchThreadContext } from "../messagesApi.js";

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

    let session = getSession(sessionId);
    const sessionInfo = restoreSessionInfo(sessionId);

    if (!sessionInfo) {
      console.error("Could not restore session info for refinement");
      return;
    }

    // If session doesn't exist on disk, recreate it from Slack context
    if (!session) {
      console.log(`Session ${sessionId} expired, recreating from Slack context`);

      const parsed = parseSessionId(sessionId);
      if (!parsed) {
        console.error("Failed to parse sessionId for recreation");
        return;
      }

      // Fetch original message and thread context from Slack
      const messageText = await fetchMessage(client, parsed.channelId, parsed.messageTs);
      if (!messageText) {
        console.error("Could not fetch original message for session recreation");
        await client.chat.postEphemeral({
          channel: sessionInfo.channelId,
          user: sessionInfo.userId,
          thread_ts: sessionInfo.threadTs,
          text: "Sorry, the session expired and I couldn't fetch the original message.",
          blocks: getErrorBlocks("Sorry, the session expired and I couldn't fetch the original message."),
        });
        return;
      }

      const threadContext = await fetchThreadContext(client, parsed.channelId, sessionInfo.threadTs);

      // Create new session (note: this creates a NEW sessionId, but we continue using the old one for this request)
      session = createSession(
        parsed.channelId,
        parsed.messageTs,
        sessionInfo.threadTs,
        parsed.userId,
        messageText,
        threadContext
      );

      // Update sessionInfo to point to the new session
      setSessionInfo(session.sessionId, {
        channelId: session.channelId,
        threadTs: session.threadTs,
        userId: session.userId,
      });

      console.log(`Recreated session as ${session.sessionId}`);
    }

    // Add refinement and regenerate
    addRefinement(session.sessionId, refinement);
    const updatedSession = getSession(session.sessionId)!;

    const response = await askClaude(updatedSession);

    if (response.success) {
      setLastAnswer(session.sessionId, response.answer);

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
        text: `Sorry, I couldn't refine the answer: ${response.error || "Unknown error"}`,
        blocks: getErrorBlocks(`Sorry, I couldn't refine the answer: ${response.error || "Unknown error"}`),
      });
    }
  });
}
