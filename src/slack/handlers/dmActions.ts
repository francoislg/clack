import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import {
  getSession,
  updateSession,
  addRefinement,
  setLastAnswer,
  type SessionContext,
} from "../../sessions.js";
import { askClaude } from "../../claude.js";
import { restoreSessionInfo, setSessionInfo } from "../state.js";
import { getAcceptedBlocks, getStructuredAcceptedBlocks } from "../blocks.js";
import {
  postDmThreadReply,
  getDmSynthesisActions,
  getDmPostAcceptActions,
} from "../dmResponse.js";
import { fetchThreadContext } from "../messagesApi.js";
import { getConfig } from "../../config.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";

/**
 * If the response contains a send_to_thread action with auto: true,
 * post the answer directly to the original channel thread (skip synthesis).
 */
async function autoSendToThread(
  client: App["client"],
  session: SessionContext,
  response: import("../../claude.js").ClaudeResponse
): Promise<void> {
  if (!response.response?.actions) return;

  const autoAction = response.response.actions.find(
    a => a.type === "send_to_thread" && "auto" in a && (a as { auto?: boolean }).auto === true
  );
  if (!autoAction) return;

  const originChannel = session.originChannel;
  const originThreadTs = session.originThreadTs;
  if (!originChannel || !originThreadTs) {
    logger.error(`Auto send_to_thread: missing origin info for session ${session.sessionId}`);
    return;
  }

  const answer = session.lastAnswer || response.answer;
  const blocks = response.response.sections
    ? getStructuredAcceptedBlocks(response.response.sections)
    : getAcceptedBlocks(answer);

  try {
    const postResult = await client.chat.postMessage({
      channel: originChannel,
      thread_ts: originThreadTs,
      blocks: blocks as any[],
      text: answer,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (postResult.ts) {
      await updateSession(session.sessionId, { channelPostTs: postResult.ts });
      const sessionInfo = await restoreSessionInfo(session.sessionId);
      if (sessionInfo) {
        setSessionInfo(session.sessionId, { ...sessionInfo, channelPostTs: postResult.ts });
      }
    }

    // Confirm in DM
    if (session.dmChannel && session.dmThreadTs) {
      await client.chat.postMessage({
        channel: session.dmChannel,
        thread_ts: session.dmThreadTs,
        text: ":white_check_mark: Answer posted to the original thread.",
      });
    }

    logger.debug(`Auto send_to_thread: posted to channel for session ${session.sessionId}`);
  } catch (error) {
    logger.error("Auto send_to_thread failed:", error);
    if (session.dmChannel && session.dmThreadTs) {
      await client.chat.postMessage({
        channel: session.dmChannel,
        thread_ts: session.dmThreadTs,
        text: ":warning: Failed to post to the original thread. You can try the button instead.",
      }).catch(() => {});
    }
  }
}

/**
 * Process a DM thread reply as a refinement for a reaction-originated session.
 */
export async function processDmRefinement(
  client: App["client"],
  session: SessionContext,
  refinementText: string
): Promise<void> {
  const config = getConfig();

  if (!session.dmChannel || !session.dmThreadTs) {
    logger.error(`Session ${session.sessionId} missing DM coordinates for refinement`);
    return;
  }

  // Add refinement to session
  await addRefinement(session.sessionId, refinementText);

  // Show thinking in DM thread
  const thinkingMsg = await client.chat.postMessage({
    channel: session.dmChannel,
    thread_ts: session.dmThreadTs,
    text: "Refining...",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: ":mag: _Refining..._" },
      },
    ],
  });

  // Re-read thread context from original channel
  const botUserId = (await client.auth.test()).user_id || "";
  const threadContext = session.originChannel && session.originThreadTs
    ? await fetchThreadContext(client, session.originChannel, session.originThreadTs, botUserId, {
        fetchUserNames: config.slack.fetchAndStoreUsername,
      })
    : session.threadContext;

  // Update session with fresh thread context
  const updatedSession = await updateSession(session.sessionId, { threadContext });
  if (!updatedSession) {
    logger.error(`Failed to update session ${session.sessionId} for refinement`);
    return;
  }

  // Call Claude
  const claudeOptions = await getClaudeOptions(session.userId, "reactions");
  const response = await askClaude(updatedSession, claudeOptions);

  // Remove thinking message
  if (thinkingMsg.ts) {
    try {
      await client.chat.delete({
        channel: session.dmChannel,
        ts: thinkingMsg.ts,
      });
    } catch {
      // Ignore — may not have permission to delete
    }
  }

  if (response.success) {
    await setLastAnswer(session.sessionId, response.answer);

    // Persist tool state
    const sessionUpdates: Record<string, unknown> = {};
    if (response.response) sessionUpdates.lastResponse = response.response;
    if (response.stagedIntents && Object.keys(response.stagedIntents).length > 0) {
      sessionUpdates.stagedIntents = response.stagedIntents;
    }
    if (response.toolCallHistory && response.toolCallHistory.length > 0) {
      sessionUpdates.toolCallHistory = response.toolCallHistory;
    }
    if (Object.keys(sessionUpdates).length > 0) {
      await updateSession(session.sessionId, sessionUpdates as any);
    }

    // Post refined answer in DM thread
    await postDmThreadReply(client, session.dmChannel, session.dmThreadTs, updatedSession, response);

    // Auto-execute send_to_thread if Claude flagged it
    await autoSendToThread(client, updatedSession, response);
  } else {
    await client.chat.postMessage({
      channel: session.dmChannel,
      thread_ts: session.dmThreadTs,
      text: `:warning: Something went wrong: ${response.error || "Unknown error"}. Try again?`,
    });
  }
}

/**
 * Synthesize the full DM conversation into a clean answer.
 */
async function synthesizeConversation(
  client: App["client"],
  session: SessionContext
): Promise<string | null> {
  if (!session.dmChannel || !session.dmThreadTs) return null;

  // Fetch the DM thread to get conversation history
  const dmReplies = await client.conversations.replies({
    channel: session.dmChannel,
    ts: session.dmThreadTs,
    limit: 100,
  });

  if (!dmReplies.messages || dmReplies.messages.length === 0) return null;

  // Build conversation summary for synthesis
  const botUserId = (await client.auth.test()).user_id || "";
  const conversation = dmReplies.messages
    .filter(m => m.text && m.ts !== session.dmThreadTs) // Skip the root investigation notice
    .map(m => {
      const isBot = m.user === botUserId || m.bot_id !== undefined;
      return `${isBot ? "Clack" : "User"}: ${m.text}`;
    })
    .join("\n\n");

  // Create a synthesis session
  const synthesisRefinement = `SYSTEM: Synthesize the following conversation into a single, clean, polished answer. Respond as if you are directly answering the original question "${session.originalQuestion}". Do not mention the conversation or refinement process. Just give the final, unified answer.\n\nConversation:\n${conversation}`;

  await addRefinement(session.sessionId, synthesisRefinement);
  const updatedSession = await getSession(session.sessionId);
  if (!updatedSession) return null;

  const claudeOptions = await getClaudeOptions(session.userId, "reactions");
  const response = await askClaude(updatedSession, claudeOptions);

  if (response.success) {
    return response.answer;
  }

  return null;
}

export function registerDmActionHandlers(app: App): void {
  // === Send to thread (triggers synthesis) ===
  app.action<BlockAction>("clack_dm_send_to_thread", async ({ ack, body, client }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    const session = await getSession(sessionId);
    const sessionInfo = await restoreSessionInfo(sessionId);

    if (!session || !sessionInfo || !session.dmChannel || !session.dmThreadTs) {
      logger.error(`Cannot send to thread: missing session or DM info for ${sessionId}`);
      return;
    }

    // Post thinking in DM thread
    await client.chat.postMessage({
      channel: session.dmChannel,
      thread_ts: session.dmThreadTs,
      text: "Preparing a summary to share...",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: ":pencil: _Preparing a summary to share..._" },
        },
      ],
    });

    // Synthesize
    const synthesis = await synthesizeConversation(client, session);

    if (!synthesis) {
      await client.chat.postMessage({
        channel: session.dmChannel,
        thread_ts: session.dmThreadTs,
        text: ":warning: Failed to generate synthesis. You can try again.",
      });
      return;
    }

    // Store synthesis as last answer
    await setLastAnswer(sessionId, synthesis);

    // Determine which actions to show: post-accept (update/new) or first-time (accept/edit/reject)
    const hasExistingPost = !!(session.channelPostTs || sessionInfo.channelPostTs);
    const actionBlocks = hasExistingPost
      ? getDmPostAcceptActions(sessionId)
      : getDmSynthesisActions(sessionId);

    // Post synthesis for approval
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: hasExistingPost
            ? "*Here's an updated summary:*"
            : "*Here's a summary to share:*",
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: synthesis },
      },
      { type: "divider" },
      ...actionBlocks,
    ];

    await client.chat.postMessage({
      channel: session.dmChannel,
      thread_ts: session.dmThreadTs,
      blocks: blocks as any[],
      text: `Summary to share: ${synthesis}`,
    });
  });

  // === Accept synthesis (post to original channel) ===
  app.action<BlockAction>("clack_dm_accept_synthesis", async ({ ack, body, client }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    const session = await getSession(sessionId);
    const sessionInfo = await restoreSessionInfo(sessionId);

    if (!session || !sessionInfo) {
      logger.error(`Cannot accept synthesis: missing session for ${sessionId}`);
      return;
    }

    const answer = session.lastAnswer;
    const originChannel = session.originChannel || sessionInfo.originChannel;
    const originThreadTs = session.originThreadTs || sessionInfo.originThreadTs;

    if (!answer || !originChannel || !originThreadTs) {
      logger.error(`Cannot accept synthesis: missing answer or origin info for ${sessionId}`);
      return;
    }

    // Post to original channel thread
    const blocks = session.lastResponse?.sections
      ? getStructuredAcceptedBlocks(session.lastResponse.sections)
      : getAcceptedBlocks(answer);

    const postResult = await client.chat.postMessage({
      channel: originChannel,
      thread_ts: originThreadTs,
      blocks: blocks as any[],
      text: answer,
      unfurl_links: false,
      unfurl_media: false,
    });

    // Store the channel post timestamp
    if (postResult.ts) {
      await updateSession(sessionId, { channelPostTs: postResult.ts });

      // Update in-memory session info
      if (sessionInfo) {
        setSessionInfo(sessionId, { ...sessionInfo, channelPostTs: postResult.ts });
      }
    }

    // Confirm in DM
    if (session.dmChannel && session.dmThreadTs) {
      await client.chat.postMessage({
        channel: session.dmChannel,
        thread_ts: session.dmThreadTs,
        text: ":white_check_mark: Answer posted to the original thread. You can continue refining here if needed.",
      });
    }

    logger.debug(`DM-first: accepted synthesis for session ${sessionId}`);
  });

  // === Edit synthesis (open modal) ===
  app.action<BlockAction>("clack_dm_edit_synthesis", async ({ ack, body, client }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    const session = await getSession(sessionId);

    if (!session?.lastAnswer) {
      logger.error(`Cannot edit synthesis: no answer for ${sessionId}`);
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "dm_edit_synthesis_modal",
        private_metadata: sessionId,
        title: { type: "plain_text", text: "Edit before sharing" },
        submit: { type: "plain_text", text: "Share" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "synthesis_content_block",
            element: {
              type: "plain_text_input",
              action_id: "synthesis_content",
              multiline: true,
              initial_value: session.lastAnswer,
            },
            label: { type: "plain_text", text: "Answer" },
          },
        ],
      },
    });
  });

  // === Edit synthesis modal submission ===
  app.view<ViewSubmitAction>("dm_edit_synthesis_modal", async ({ ack, view, client }) => {
    await ack();

    const sessionId = view.private_metadata;
    const editedAnswer = view.state.values.synthesis_content_block.synthesis_content.value;
    const session = await getSession(sessionId);
    const sessionInfo = await restoreSessionInfo(sessionId);

    if (!session || !sessionInfo || !editedAnswer) {
      logger.error(`Cannot post edited synthesis for ${sessionId}`);
      return;
    }

    const originChannel = session.originChannel || sessionInfo.originChannel;
    const originThreadTs = session.originThreadTs || sessionInfo.originThreadTs;

    if (!originChannel || !originThreadTs) {
      logger.error(`Missing origin info for edited synthesis ${sessionId}`);
      return;
    }

    // Store edited answer
    await setLastAnswer(sessionId, editedAnswer);

    // Post to original channel
    const postResult = await client.chat.postMessage({
      channel: originChannel,
      thread_ts: originThreadTs,
      blocks: getAcceptedBlocks(editedAnswer) as any[],
      text: editedAnswer,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (postResult.ts) {
      await updateSession(sessionId, { channelPostTs: postResult.ts });
      if (sessionInfo) {
        setSessionInfo(sessionId, { ...sessionInfo, channelPostTs: postResult.ts });
      }
    }

    // Confirm in DM
    if (session.dmChannel && session.dmThreadTs) {
      await client.chat.postMessage({
        channel: session.dmChannel,
        thread_ts: session.dmThreadTs,
        text: ":white_check_mark: Edited answer posted to the original thread.",
      });
    }

    logger.debug(`DM-first: posted edited synthesis for session ${sessionId}`);
  });

  // === DM reject ===
  app.action<BlockAction>("clack_dm_reject", async ({ ack, body, client }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    const session = await getSession(sessionId);

    if (session?.dmChannel && session.dmThreadTs) {
      await client.chat.postMessage({
        channel: session.dmChannel,
        thread_ts: session.dmThreadTs,
        text: "Got it, discarded.",
      });
    }

    logger.debug(`DM-first: rejected for session ${sessionId}`);
  });

  // === Update original post (post-accept) ===
  app.action<BlockAction>("clack_dm_update_post", async ({ ack, body, client }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    const session = await getSession(sessionId);
    const sessionInfo = await restoreSessionInfo(sessionId);

    if (!session || !sessionInfo) {
      logger.error(`Cannot update post: missing session for ${sessionId}`);
      return;
    }

    const answer = session.lastAnswer;
    const originChannel = session.originChannel || sessionInfo.originChannel;
    const channelPostTs = session.channelPostTs || sessionInfo.channelPostTs;

    if (!answer || !originChannel || !channelPostTs) {
      logger.error(`Cannot update post: missing data for ${sessionId}`);
      return;
    }

    const blocks = session.lastResponse?.sections
      ? getStructuredAcceptedBlocks(session.lastResponse.sections)
      : getAcceptedBlocks(answer);

    await client.chat.update({
      channel: originChannel,
      ts: channelPostTs,
      blocks: blocks as any[],
      text: answer,
    });

    // Confirm in DM
    if (session.dmChannel && session.dmThreadTs) {
      await client.chat.postMessage({
        channel: session.dmChannel,
        thread_ts: session.dmThreadTs,
        text: ":white_check_mark: Original post updated.",
      });
    }

    logger.debug(`DM-first: updated channel post for session ${sessionId}`);
  });

  // === Post new reply (post-accept) ===
  app.action<BlockAction>("clack_dm_post_new", async ({ ack, body, client }) => {
    await ack();

    const sessionId = (body.actions[0] as { value: string }).value;
    const session = await getSession(sessionId);
    const sessionInfo = await restoreSessionInfo(sessionId);

    if (!session || !sessionInfo) {
      logger.error(`Cannot post new reply: missing session for ${sessionId}`);
      return;
    }

    const answer = session.lastAnswer;
    const originChannel = session.originChannel || sessionInfo.originChannel;
    const originThreadTs = session.originThreadTs || sessionInfo.originThreadTs;

    if (!answer || !originChannel || !originThreadTs) {
      logger.error(`Cannot post new reply: missing data for ${sessionId}`);
      return;
    }

    const blocks = session.lastResponse?.sections
      ? getStructuredAcceptedBlocks(session.lastResponse.sections)
      : getAcceptedBlocks(answer);

    const postResult = await client.chat.postMessage({
      channel: originChannel,
      thread_ts: originThreadTs,
      blocks: blocks as any[],
      text: answer,
      unfurl_links: false,
      unfurl_media: false,
    });

    // Update stored channel post timestamp
    if (postResult.ts) {
      await updateSession(sessionId, { channelPostTs: postResult.ts });
      if (sessionInfo) {
        setSessionInfo(sessionId, { ...sessionInfo, channelPostTs: postResult.ts });
      }
    }

    // Confirm in DM
    if (session.dmChannel && session.dmThreadTs) {
      await client.chat.postMessage({
        channel: session.dmChannel,
        thread_ts: session.dmThreadTs,
        text: ":white_check_mark: New reply posted to the original thread.",
      });
    }

    logger.debug(`DM-first: posted new reply for session ${sessionId}`);
  });
}
