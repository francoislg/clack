import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession, updateSession, setLastAnswer, type SessionContext } from "../../sessions.js";
import type { ResponseSnapshot } from "../../tools/types.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import {
  getAcceptedBlocks,
  getStructuredAcceptedBlocks,
  decodeActionValue,
  asSlackBlocks,
} from "../blocks.js";

/**
 * Shared session resolution for DM action handlers.
 * Decodes action value, loads session + sessionInfo, and returns null (posting an ephemeral error) if either is missing.
 */
async function resolveActionSession(
  rawValue: string,
  client: App["client"],
  channelId: string | undefined,
  userId: string,
): Promise<{
  sessionId: string;
  ref?: string;
  session: SessionContext;
  sessionInfo: SessionInfo;
} | null> {
  const decoded = decodeActionValue(rawValue);
  const session = await getSession(decoded.sessionId);
  const sessionInfo = await activeSessions.restore(decoded.sessionId);

  if (!session || !sessionInfo) {
    logger.error(`DM action: missing session for ${decoded.sessionId}`);
    if (channelId) {
      await client.chat
        .postEphemeral({
          channel: channelId,
          user: userId,
          text: "Sorry, this session has expired. Please try again.",
        })
        .catch(() => {});
    }
    return null;
  }

  return { sessionId: decoded.sessionId, ref: decoded.ref, session, sessionInfo };
}

/**
 * Post snapshot content to a target channel or thread.
 * Content comes from the dedicated snapshot entry (persisted at creation time).
 */
export async function postAnswerToChannel(
  client: App["client"],
  snapshot: ResponseSnapshot,
  targetChannel: string,
  targetThreadTs?: string,
): Promise<{ ok: boolean; ts?: string }> {
  const blocks = snapshot.sections
    ? getStructuredAcceptedBlocks(snapshot.sections)
    : getAcceptedBlocks(snapshot.text);

  const result = await client.chat.postMessage({
    channel: targetChannel,
    ...(targetThreadTs ? { thread_ts: targetThreadTs } : {}),
    blocks: asSlackBlocks(blocks),
    text: snapshot.text,
    unfurl_links: false,
    unfurl_media: false,
  });

  return { ok: true, ts: result.ts ?? undefined };
}

/** Resolve originChannel and originThreadTs from session + sessionInfo. */
export function resolveOrigin(
  session: SessionContext,
  sessionInfo: SessionInfo,
): { originChannel: string | undefined; originThreadTs: string | undefined } {
  return {
    originChannel: session.originChannel || sessionInfo.originChannel,
    originThreadTs: session.originThreadTs || sessionInfo.originThreadTs,
  };
}

/** Build Block Kit blocks from session response sections or plain answer text. */
function buildAnswerBlocks(session: SessionContext, answer: string) {
  return session.lastResponse?.sections
    ? getStructuredAcceptedBlocks(session.lastResponse.sections)
    : getAcceptedBlocks(answer);
}

/** Persist channelPostTs to both session storage and in-memory sessionInfo. */
async function persistChannelPost(
  sessionId: string,
  sessionInfo: SessionInfo,
  ts: string,
): Promise<void> {
  await updateSession(sessionId, { channelPostTs: ts });
  activeSessions.set(sessionId, { ...sessionInfo, channelPostTs: ts });
}

/** Send a confirmation message in the DM thread, if DM coordinates exist. */
async function confirmInDm(
  client: App["client"],
  session: SessionContext,
  text: string,
): Promise<void> {
  const channel = session.dmChannel || session.channelId;
  const threadTs = session.dmThreadTs || session.threadTs;
  if (channel && threadTs) {
    await client.chat.postMessage({ channel, thread_ts: threadTs, text });
  }
}

// ---------------------------------------------------------------------------
// Individual action handlers
// ---------------------------------------------------------------------------

/** Post snapshot content to a target channel or thread. */
async function handlePostTo(body: BlockAction, client: App["client"]): Promise<void> {
  const rawValue = (body.actions[0] as { value: string }).value;
  const resolved = await resolveActionSession(rawValue, client, body.channel?.id, body.user.id);
  if (!resolved) return;
  const { sessionId, session, sessionInfo } = resolved;

  // Resolve per-button content (each button has its own content entry persisted at creation time)
  const decoded = decodeActionValue(rawValue);
  const snapshot = decoded.snapshotId ? session.snapshots?.[decoded.snapshotId] : undefined;

  if (!snapshot) {
    logger.error(
      `post_to failed: missing content entry for ${sessionId} (snapshotId: ${decoded.snapshotId ?? "none"})`,
    );
    return;
  }

  // Resolve target channel/thread via fallback chain:
  // explicit button target > DM-first origin > assistant channel > session channel
  const { originChannel, originThreadTs } = resolveOrigin(session, sessionInfo);
  const targetChannel =
    decoded.targetChannel ||
    originChannel ||
    session.assistantCurrentChannelId ||
    session.channelId;
  const targetThreadTs = decoded.targetThreadTs || originThreadTs || undefined;

  if (!targetChannel) {
    logger.error(`post_to failed: missing target channel for ${sessionId}`);
    return;
  }

  try {
    const result = await postAnswerToChannel(client, snapshot, targetChannel, targetThreadTs);

    if (result.ts) {
      await persistChannelPost(sessionId, sessionInfo, result.ts);
    }

    await confirmInDm(client, session, ":white_check_mark: Answer shared.");
  } catch (error) {
    logger.error("post_to failed:", error);
    const channel = session.dmChannel || session.channelId;
    const threadTs = session.dmThreadTs || session.threadTs;
    if (channel && threadTs) {
      await client.chat
        .postMessage({
          channel,
          thread_ts: threadTs,
          text: ":warning: Failed to post. The bot may not have access to that channel.",
        })
        .catch(() => {});
    }
  }
}

/** Accept the synthesis and post it to the original channel. */
async function handleAcceptSynthesis(body: BlockAction, client: App["client"]): Promise<void> {
  const rawValue = (body.actions[0] as { value: string }).value;
  const resolved = await resolveActionSession(rawValue, client, body.channel?.id, body.user.id);
  if (!resolved) return;
  const { sessionId, session, sessionInfo } = resolved;

  const answer = session.lastAnswer;
  const { originChannel, originThreadTs } = resolveOrigin(session, sessionInfo);
  const targetChannel = originChannel || session.assistantCurrentChannelId;

  if (!answer || !targetChannel) {
    logger.error(`Cannot accept synthesis: missing answer or target info for ${sessionId}`);
    return;
  }

  const postResult = await client.chat.postMessage({
    channel: targetChannel,
    ...(originThreadTs ? { thread_ts: originThreadTs } : {}),
    blocks: asSlackBlocks(buildAnswerBlocks(session, answer)),
    text: answer,
    unfurl_links: false,
    unfurl_media: false,
  });

  if (postResult.ts) {
    await persistChannelPost(sessionId, sessionInfo, postResult.ts);
  }

  await confirmInDm(
    client,
    session,
    ":white_check_mark: Answer posted to the channel. You can continue refining here if needed.",
  );

  logger.debug(`DM-first: accepted synthesis for session ${sessionId}`);
}

/** Open modal to edit the synthesis before sharing. */
async function handleEditSynthesis(body: BlockAction, client: App["client"]): Promise<void> {
  const sessionId = (body.actions[0] as { value: string }).value;
  const session = await getSession(sessionId);

  if (!session?.lastAnswer) {
    logger.error(`Cannot edit synthesis: no answer for ${sessionId}`);
    if (body.channel?.id) {
      await client.chat
        .postEphemeral({
          channel: body.channel.id,
          user: body.user.id,
          text: "Sorry, this session has expired or has no answer to edit.",
        })
        .catch(() => {});
    }
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
}

/** Handle submission of the edit-synthesis modal. */
async function handleEditSynthesisSubmit(
  view: ViewSubmitAction["view"],
  client: App["client"],
): Promise<void> {
  const sessionId = view.private_metadata;
  const editedAnswer = view.state.values.synthesis_content_block.synthesis_content.value;
  const session = await getSession(sessionId);
  const sessionInfo = await activeSessions.restore(sessionId);

  if (!session || !sessionInfo || !editedAnswer) {
    logger.error(`Cannot post edited synthesis for ${sessionId}`);
    return;
  }

  const { originChannel, originThreadTs } = resolveOrigin(session, sessionInfo);

  if (!originChannel || !originThreadTs) {
    logger.error(`Missing origin info for edited synthesis ${sessionId}`);
    return;
  }

  await setLastAnswer(sessionId, editedAnswer);

  const postResult = await client.chat.postMessage({
    channel: originChannel,
    thread_ts: originThreadTs,
    blocks: asSlackBlocks(getAcceptedBlocks(editedAnswer)),
    text: editedAnswer,
    unfurl_links: false,
    unfurl_media: false,
  });

  if (postResult.ts) {
    await persistChannelPost(sessionId, sessionInfo, postResult.ts);
  }

  if (session.dmChannel && session.dmThreadTs) {
    await client.chat.postMessage({
      channel: session.dmChannel,
      thread_ts: session.dmThreadTs,
      text: ":white_check_mark: Edited answer posted to the original thread.",
    });
  }

  logger.debug(`DM-first: posted edited synthesis for session ${sessionId}`);
}

/** Handle rejection — user discards the answer. */
async function handleReject(body: BlockAction, client: App["client"]): Promise<void> {
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
}

/** Update an already-posted channel message with the latest answer. */
async function handleUpdatePost(body: BlockAction, client: App["client"]): Promise<void> {
  const rawValue = (body.actions[0] as { value: string }).value;
  const resolved = await resolveActionSession(rawValue, client, body.channel?.id, body.user.id);
  if (!resolved) return;
  const { sessionId, session, sessionInfo } = resolved;

  const answer = session.lastAnswer;
  const { originChannel } = resolveOrigin(session, sessionInfo);
  const channelPostTs = session.channelPostTs || sessionInfo.channelPostTs;

  if (!answer || !originChannel || !channelPostTs) {
    logger.error(`Cannot update post: missing data for ${sessionId}`);
    return;
  }

  await client.chat.update({
    channel: originChannel,
    ts: channelPostTs,
    blocks: asSlackBlocks(buildAnswerBlocks(session, answer)),
    text: answer,
  });

  await confirmInDm(client, session, ":white_check_mark: Original post updated.");

  logger.debug(`DM-first: updated channel post for session ${sessionId}`);
}

/** Post a new reply to the original thread with the latest answer. */
async function handlePostNew(body: BlockAction, client: App["client"]): Promise<void> {
  const rawValue = (body.actions[0] as { value: string }).value;
  const resolved = await resolveActionSession(rawValue, client, body.channel?.id, body.user.id);
  if (!resolved) return;
  const { sessionId, session, sessionInfo } = resolved;

  const answer = session.lastAnswer;
  const { originChannel, originThreadTs } = resolveOrigin(session, sessionInfo);

  if (!answer || !originChannel || !originThreadTs) {
    logger.error(`Cannot post new reply: missing data for ${sessionId}`);
    return;
  }

  const postResult = await client.chat.postMessage({
    channel: originChannel,
    thread_ts: originThreadTs,
    blocks: asSlackBlocks(buildAnswerBlocks(session, answer)),
    text: answer,
    unfurl_links: false,
    unfurl_media: false,
  });

  if (postResult.ts) {
    await persistChannelPost(sessionId, sessionInfo, postResult.ts);
  }

  await confirmInDm(client, session, ":white_check_mark: New reply posted to the original thread.");

  logger.debug(`DM-first: posted new reply for session ${sessionId}`);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDmActionHandlers(app: App): void {
  // New action ID
  app.action<BlockAction>(/^clack_post_to_\d+$/, async ({ ack, body, client }) => {
    await ack();
    await handlePostTo(body, client);
  });

  // Backward compat: old action ID from sessions created before rename.
  // Can be removed once all Slack messages with old buttons have expired.
  app.action<BlockAction>(/^clack_dm_send_to_thread_\d+$/, async ({ ack, body, client }) => {
    await ack();
    await handlePostTo(body, client);
  });

  app.action<BlockAction>("clack_dm_accept_synthesis", async ({ ack, body, client }) => {
    await ack();
    await handleAcceptSynthesis(body, client);
  });

  app.action<BlockAction>("clack_dm_edit_synthesis", async ({ ack, body, client }) => {
    await ack();
    await handleEditSynthesis(body, client);
  });

  app.view<ViewSubmitAction>("dm_edit_synthesis_modal", async ({ ack, view, client }) => {
    await ack();
    await handleEditSynthesisSubmit(view, client);
  });

  app.action<BlockAction>("clack_dm_reject", async ({ ack, body, client }) => {
    await ack();
    await handleReject(body, client);
  });

  app.action<BlockAction>("clack_dm_update_post", async ({ ack, body, client }) => {
    await ack();
    await handleUpdatePost(body, client);
  });

  app.action<BlockAction>("clack_dm_post_new", async ({ ack, body, client }) => {
    await ack();
    await handlePostNew(body, client);
  });
}
