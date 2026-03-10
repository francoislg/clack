import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import {
  getSession,
  updateSession,
  setLastAnswer,
  type SessionContext,
} from "../../sessions.js";
import type { ResponseSnapshot } from "../../tools/types.js";
import { restoreSessionInfo, setSessionInfo } from "../state.js";
import { getAcceptedBlocks, getStructuredAcceptedBlocks, decodeActionValue } from "../blocks.js";

/**
 * Resolve answer text from session, preferring lastAnswer but falling back
 * to lastResponse.sections (covers the window between delivery and persistence).
 */
function resolveAnswerText(session: SessionContext): string | undefined {
  if (session.lastAnswer) return session.lastAnswer;
  if (session.lastResponse?.sections) {
    return session.lastResponse.sections
      .map((s) => (s.title ? `**${s.title}**\n${s.body}` : s.body))
      .join("\n\n");
  }
  return undefined;
}

/**
 * Post an answer directly to a target channel. Uses snapshot content when
 * available (each "Send to thread" button captures its own snapshot at
 * delivery time), falling back to session.lastAnswer / lastResponse.
 */
async function postAnswerToChannel(
  client: App["client"],
  session: SessionContext,
  targetChannel: string,
  targetThreadTs?: string,
  snapshot?: ResponseSnapshot,
): Promise<{ ok: boolean; ts?: string }> {
  const answer = snapshot?.text ?? resolveAnswerText(session);
  if (!answer) return { ok: false };

  const sections = snapshot?.sections ?? session.lastResponse?.sections;
  const blocks = sections
    ? getStructuredAcceptedBlocks(sections)
    : getAcceptedBlocks(answer);

  const result = await client.chat.postMessage({
    channel: targetChannel,
    ...(targetThreadTs ? { thread_ts: targetThreadTs } : {}),
    blocks: blocks as any[],
    text: answer,
    unfurl_links: false,
    unfurl_media: false,
  });

  return { ok: true, ts: result.ts ?? undefined };
}

export function registerDmActionHandlers(app: App): void {
  // === Send to thread (post snapshot content to target channel) ===
  app.action<BlockAction>(/^clack_dm_send_to_thread_\d+$/, async ({ ack, body, client }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const decoded = decodeActionValue(rawValue);
    const sessionId = decoded.sessionId;
    const session = await getSession(sessionId);
    const sessionInfo = await restoreSessionInfo(sessionId);

    if (!session || !sessionInfo) {
      logger.error(`Cannot send to thread: missing session for ${sessionId}`);
      return;
    }

    // Resolve snapshot (each button captures its own content at delivery time)
    const snapshot = decoded.snapshotId
      ? session.variables?.[decoded.snapshotId]
      : undefined;

    // Resolve target channel/thread via fallback chain:
    // explicit button target > DM-first origin > assistant channel > session channel
    const targetChannel = decoded.targetChannel
      || session.originChannel || sessionInfo.originChannel
      || session.assistantCurrentChannelId
      || session.channelId;
    const targetThreadTs = decoded.targetThreadTs
      || session.originThreadTs || sessionInfo.originThreadTs
      || undefined;

    if (!targetChannel || (!snapshot && !session.lastAnswer)) {
      logger.error(`Cannot send to thread: missing target or answer for ${sessionId}`);
      return;
    }

    // Confirm in the conversation thread (DM or original)
    const confirmChannel = session.dmChannel || session.channelId;
    const confirmThreadTs = session.dmThreadTs || session.threadTs;

    try {
      const result = await postAnswerToChannel(client, session, targetChannel, targetThreadTs, snapshot);

      if (result.ts) {
        await updateSession(sessionId, { channelPostTs: result.ts });
        setSessionInfo(sessionId, { ...sessionInfo, channelPostTs: result.ts });
      }

      if (confirmChannel && confirmThreadTs) {
        await client.chat.postMessage({
          channel: confirmChannel,
          thread_ts: confirmThreadTs,
          text: ":white_check_mark: Answer shared.",
        });
      }
    } catch (error) {
      logger.error("Send to thread failed:", error);
      if (confirmChannel && confirmThreadTs) {
        await client.chat.postMessage({
          channel: confirmChannel,
          thread_ts: confirmThreadTs,
          text: ":warning: Failed to post. The bot may not have access to that channel.",
        }).catch(() => {});
      }
    }
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
    // Target: DM-first uses originChannel+thread, assistant uses current channel (top-level)
    const originChannel = session.originChannel || sessionInfo.originChannel;
    const originThreadTs = session.originThreadTs || sessionInfo.originThreadTs;
    const targetChannel = originChannel || session.assistantCurrentChannelId;

    if (!answer || !targetChannel) {
      logger.error(`Cannot accept synthesis: missing answer or target info for ${sessionId}`);
      return;
    }

    // Post to target channel (threaded for DM-first, top-level for assistant)
    const blocks = session.lastResponse?.sections
      ? getStructuredAcceptedBlocks(session.lastResponse.sections)
      : getAcceptedBlocks(answer);

    const postResult = await client.chat.postMessage({
      channel: targetChannel,
      ...(originThreadTs ? { thread_ts: originThreadTs } : {}),
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

    // Confirm in the thread (DM or assistant)
    const confirmChannel = session.dmChannel || session.channelId;
    const confirmThreadTs = session.dmThreadTs || session.threadTs;
    if (confirmChannel && confirmThreadTs) {
      await client.chat.postMessage({
        channel: confirmChannel,
        thread_ts: confirmThreadTs,
        text: ":white_check_mark: Answer posted to the channel. You can continue refining here if needed.",
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
