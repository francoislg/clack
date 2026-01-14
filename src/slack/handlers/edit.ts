import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { getSession, touchSession } from "../../sessions.js";
import { getAcceptedBlocks } from "../blocks.js";
import { restoreSessionInfo, deleteSessionInfo } from "../state.js";

export function registerEditHandler(app: App): void {
  // Handle Edit button - open modal with current answer
  app.action<BlockAction>("clack_edit", async ({ ack, body, client, respond }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    const session = await getSession(sessionId);

    if (!session?.lastAnswer) {
      console.error("No answer found for editing");
      return;
    }

    // Delete the ephemeral message
    await respond({ delete_original: true });

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "clack_edit_modal",
        private_metadata: sessionId,
        title: {
          type: "plain_text",
          text: "Edit & Accept",
        },
        submit: {
          type: "plain_text",
          text: "Post",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
            type: "input",
            block_id: "edit_block",
            element: {
              type: "plain_text_input",
              action_id: "edit_input",
              multiline: true,
              initial_value: session.lastAnswer,
            },
            label: {
              type: "plain_text",
              text: "Answer",
            },
          },
        ],
      },
    });
  });

  // Handle Edit modal submission
  app.view<ViewSubmitAction>("clack_edit_modal", async ({ ack, view, client }) => {
    await ack();

    const sessionId = view.private_metadata;
    const editedAnswer = view.state.values.edit_block.edit_input.value || "";

    const sessionInfo = await restoreSessionInfo(sessionId);

    if (!sessionInfo) {
      console.error("Session info not found for edit");
      return;
    }

    // Post public message with the edited answer (visible to everyone)
    await client.chat.postMessage({
      channel: sessionInfo.channelId,
      thread_ts: sessionInfo.threadTs,
      blocks: getAcceptedBlocks(editedAnswer),
      text: editedAnswer,
      unfurl_links: false,
      unfurl_media: false,
    });

    deleteSessionInfo(sessionId);
    await touchSession(sessionId);
    console.log(`Posted edited answer for session ${sessionId}`);
  });
}
