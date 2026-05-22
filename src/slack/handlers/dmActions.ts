import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import {
  getSession,
  updateSession,
  appendAssistantMessage,
  type SessionContext,
} from "../../sessions.js";
import { latestAssistantText, latestAssistantPayload } from "../../sessions/selectors.js";
import type { Action, ResponseSnapshot } from "../../tools/types.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import {
  getResponseActionBlocks,
  getStructuredAcceptedBlocks,
  decodeActionValue,
  asSlackBlocks,
} from "../blocks.js";
import type { AuthoredTableBlock, Block } from "../blockSchema.js";
import type { SectionBlock } from "@slack/types";
import { addDeliveryReactions } from "../messageReactions.js";
import { unfurlOptions } from "../unfurlOptions.js";
import { extractDisplayText } from "../blockText.js";

/** Fallback for callers that only have a plain-text answer (no structured blocks). */
function textToBlocks(text: string): Block[] {
  const section: SectionBlock = { type: "section", text: { type: "mrkdwn", text } };
  return [section];
}

/**
 * True if the persisted snapshot matches the current `ResponseSnapshot` shape
 * (has a `blocks` array). Legacy snapshots persisted before the Block Kit
 * migration had a `sections: [{body, title?}]` shape and lack `blocks`.
 */
function isCurrentSnapshot(snapshot: Partial<ResponseSnapshot>): snapshot is ResponseSnapshot {
  return Array.isArray(snapshot.blocks);
}

export interface DmActionsDeps {
  getSession: (sessionId: string) => Promise<SessionContext | null>;
  updateSession: (
    sessionId: string,
    updates: Partial<SessionContext>,
  ) => Promise<SessionContext | null>;
  appendAssistantMessage: typeof appendAssistantMessage;
  restoreSession: (sessionId: string) => Promise<SessionInfo | undefined>;
  setSessionInfo: (sessionId: string, info: SessionInfo) => void;
  decodeActionValue: typeof decodeActionValue;
  getStructuredAcceptedBlocks: typeof getStructuredAcceptedBlocks;
  asSlackBlocks: typeof asSlackBlocks;
}

export const defaultDmActionsDeps: DmActionsDeps = {
  getSession,
  updateSession: updateSession as never,
  appendAssistantMessage,
  restoreSession: (sessionId: string) => activeSessions.restore(sessionId),
  setSessionInfo: (sessionId, info) => activeSessions.set(sessionId, info),
  decodeActionValue,
  getStructuredAcceptedBlocks,
  asSlackBlocks,
};

/**
 * Shared session resolution for DM action handlers.
 * Decodes action value, loads session + sessionInfo, and returns null (posting an ephemeral error) if either is missing.
 */
async function resolveActionSession(
  rawValue: string,
  client: App["client"],
  channelId: string | undefined,
  userId: string,
  deps: DmActionsDeps,
): Promise<{
  sessionId: string;
  ref?: string;
  session: SessionContext;
  sessionInfo: SessionInfo;
} | null> {
  const decoded = deps.decodeActionValue(rawValue);
  const session = await deps.getSession(decoded.sessionId);
  const sessionInfo = await deps.restoreSession(decoded.sessionId);

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
 *
 * Optional `actions` are rendered as Slack action buttons appended to the
 * cross-posted message; their click handlers route back to the original
 * session (via the `sessionId` encoded in each button's value). Optional
 * `reactions` are added to the cross-posted message after delivery via the
 * shared `addDeliveryReactions` helper.
 */
export async function postAnswerToChannel(
  client: App["client"],
  snapshot: ResponseSnapshot,
  targetChannel: string,
  targetThreadTs?: string,
  deps: DmActionsDeps = defaultDmActionsDeps,
  opts: {
    sessionId?: string;
    actions?: Action[];
    reactions?: string[];
    suppressUnfurls?: boolean;
  } = {},
): Promise<{ ok: boolean; ts?: string }> {
  const contentBlocks = deps.getStructuredAcceptedBlocks(snapshot.blocks, snapshot.table);

  // Append rendered action buttons when post_to.actions are present.
  // The original session's ID is passed through so click handlers resolve
  // ref-based actions against the same intentStore as the original thread.
  const actions = opts.actions ?? snapshot.actions;
  const renderedActionBlocks =
    actions && actions.length > 0 && opts.sessionId
      ? getResponseActionBlocks(actions, opts.sessionId)
      : [];

  const suppressUnfurls = opts.suppressUnfurls ?? snapshot.suppressUnfurls;
  const result = await client.chat.postMessage({
    channel: targetChannel,
    ...(targetThreadTs ? { thread_ts: targetThreadTs } : {}),
    blocks: deps.asSlackBlocks([...contentBlocks, ...renderedActionBlocks]),
    text: snapshot.text,
    ...unfurlOptions(suppressUnfurls),
  });

  const ts = result.ts ?? undefined;

  const reactions = opts.reactions ?? snapshot.reactions;
  if (ts && reactions && reactions.length > 0) {
    addDeliveryReactions(client, targetChannel, ts, reactions).catch((err) =>
      logger.warn(`addDeliveryReactions threw: ${err}`),
    );
  }

  // Replay multi-message followers persisted on the snapshot. Mirrors the submit_response
  // delivery semantics:
  //  - `additional_messages` are separate TOP-LEVEL channel messages (no thread_ts) in the
  //    same target channel as the primary cross-post.
  //  - `thread_replies` are replies threaded under the primary cross-post (`ts` returned above).
  const additional = snapshot.additional_messages ?? [];
  const replies = snapshot.thread_replies ?? [];
  for (const msg of additional) {
    await deliverFollower(client, opts.sessionId, msg, {
      channel: targetChannel,
      threadTs: undefined, // top-level channel post
      suppressUnfurls,
      deps,
    });
  }
  if (replies.length > 0 && ts) {
    for (const msg of replies) {
      await deliverFollower(client, opts.sessionId, msg, {
        channel: targetChannel,
        threadTs: ts, // threaded under primary's ts
        suppressUnfurls,
        deps,
      });
    }
  }

  return { ok: true, ts };
}

/** Render and post one follower message in a post_to batch. */
async function deliverFollower(
  client: App["client"],
  sessionId: string | undefined,
  msg: { blocks: Block[]; table?: AuthoredTableBlock; actions?: Action[]; reactions?: string[] },
  ctx: {
    channel: string;
    /** When set: posted as thread reply. When undefined: posted as top-level channel message. */
    threadTs: string | undefined;
    suppressUnfurls?: boolean;
    deps: DmActionsDeps;
  },
): Promise<void> {
  const contentBlocks = ctx.deps.getStructuredAcceptedBlocks(msg.blocks, msg.table);
  const renderedActionBlocks =
    msg.actions && msg.actions.length > 0 && sessionId
      ? getResponseActionBlocks(msg.actions, sessionId)
      : [];
  const followerText = extractDisplayText(msg.blocks);
  const followerResult = await client.chat.postMessage({
    channel: ctx.channel,
    ...(ctx.threadTs ? { thread_ts: ctx.threadTs } : {}),
    blocks: ctx.deps.asSlackBlocks([...contentBlocks, ...renderedActionBlocks]),
    text: followerText,
    ...unfurlOptions(ctx.suppressUnfurls),
  });
  const followerTs = followerResult.ts ?? undefined;
  if (followerTs && msg.reactions && msg.reactions.length > 0) {
    addDeliveryReactions(client, ctx.channel, followerTs, msg.reactions).catch((err) =>
      logger.warn(`addDeliveryReactions threw: ${err}`),
    );
  }
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

/** Build Block Kit blocks from session response blocks, or a single-section fallback from plain answer text. */
function buildAnswerBlocks(session: SessionContext, answer: string, deps: DmActionsDeps) {
  const payload = latestAssistantPayload(session);
  const sourceBlocks = payload?.blocks ?? textToBlocks(answer);
  return deps.getStructuredAcceptedBlocks(sourceBlocks);
}

/** Persist channelPostTs to both session storage and in-memory sessionInfo. */
async function persistChannelPost(
  sessionId: string,
  sessionInfo: SessionInfo,
  ts: string,
  deps: DmActionsDeps,
): Promise<void> {
  await deps.updateSession(sessionId, { channelPostTs: ts } as Partial<SessionContext>);
  deps.setSessionInfo(sessionId, { ...sessionInfo, channelPostTs: ts });
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
async function handlePostTo(
  body: BlockAction,
  client: App["client"],
  deps: DmActionsDeps,
): Promise<void> {
  const rawValue = (body.actions[0] as { value: string }).value;
  const resolved = await resolveActionSession(
    rawValue,
    client,
    body.channel?.id,
    body.user.id,
    deps,
  );
  if (!resolved) return;
  const { sessionId, session, sessionInfo } = resolved;

  // Resolve per-button content (each button has its own content entry persisted at creation time)
  const decoded = deps.decodeActionValue(rawValue);
  const snapshot = decoded.snapshotId ? session.snapshots?.[decoded.snapshotId] : undefined;

  if (!snapshot) {
    logger.error(
      `post_to failed: missing content entry for ${sessionId} (snapshotId: ${decoded.snapshotId ?? "none"})`,
    );
    return;
  }

  // Legacy snapshots (persisted before the Block Kit migration) lack `blocks`.
  // Tell the user the link expired rather than crashing at post time.
  if (!isCurrentSnapshot(snapshot)) {
    logger.warn(
      `post_to: legacy snapshot shape for ${sessionId} (snapshotId: ${decoded.snapshotId ?? "none"}) — telling user it expired`,
    );
    await confirmInDm(
      client,
      session,
      ":warning: This button is from an older response and can no longer be posted. Ask Clack again to get a fresh copy.",
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
    const result = await postAnswerToChannel(
      client,
      snapshot,
      targetChannel,
      targetThreadTs,
      deps,
      { sessionId },
    );

    if (result.ts) {
      await persistChannelPost(sessionId, sessionInfo, result.ts, deps);
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
async function handleAcceptSynthesis(
  body: BlockAction,
  client: App["client"],
  deps: DmActionsDeps,
): Promise<void> {
  const rawValue = (body.actions[0] as { value: string }).value;
  const resolved = await resolveActionSession(
    rawValue,
    client,
    body.channel?.id,
    body.user.id,
    deps,
  );
  if (!resolved) return;
  const { sessionId, session, sessionInfo } = resolved;

  const answer = latestAssistantText(session);
  const { originChannel, originThreadTs } = resolveOrigin(session, sessionInfo);
  const targetChannel = originChannel || session.assistantCurrentChannelId;

  if (!answer || !targetChannel) {
    logger.error(`Cannot accept synthesis: missing answer or target info for ${sessionId}`);
    return;
  }

  const postResult = await client.chat.postMessage({
    channel: targetChannel,
    ...(originThreadTs ? { thread_ts: originThreadTs } : {}),
    blocks: deps.asSlackBlocks(buildAnswerBlocks(session, answer, deps)),
    text: answer,
    unfurl_links: false,
    unfurl_media: false,
  });

  if (postResult.ts) {
    await persistChannelPost(sessionId, sessionInfo, postResult.ts, deps);
  }

  await confirmInDm(
    client,
    session,
    ":white_check_mark: Answer posted to the channel. You can continue refining here if needed.",
  );

  logger.debug(`DM-first: accepted synthesis for session ${sessionId}`);
}

/** Open modal to edit the synthesis before sharing. */
async function handleEditSynthesis(
  body: BlockAction,
  client: App["client"],
  deps: DmActionsDeps,
): Promise<void> {
  const sessionId = (body.actions[0] as { value: string }).value;
  const session = await deps.getSession(sessionId);
  const answer = session ? latestAssistantText(session) : undefined;

  if (!session || !answer) {
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
            initial_value: answer,
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
  deps: DmActionsDeps,
): Promise<void> {
  const sessionId = view.private_metadata;
  const editedAnswer = view.state.values.synthesis_content_block.synthesis_content.value;
  const session = await deps.getSession(sessionId);
  const sessionInfo = await deps.restoreSession(sessionId);

  if (!session || !sessionInfo || !editedAnswer) {
    logger.error(`Cannot post edited synthesis for ${sessionId}`);
    return;
  }

  const { originChannel, originThreadTs } = resolveOrigin(session, sessionInfo);

  if (!originChannel || !originThreadTs) {
    logger.error(`Missing origin info for edited synthesis ${sessionId}`);
    return;
  }

  // Record the user-edited synthesis as a new assistant turn so future reads via
  // `latestAssistantText()` return the edit, matching the prior `setLastAnswer` behavior.
  await deps.appendAssistantMessage(sessionId, {
    role: "assistant",
    ts: Date.now(),
    text: editedAnswer,
  });

  const postResult = await client.chat.postMessage({
    channel: originChannel,
    thread_ts: originThreadTs,
    blocks: deps.asSlackBlocks(deps.getStructuredAcceptedBlocks(textToBlocks(editedAnswer))),
    text: editedAnswer,
    unfurl_links: false,
    unfurl_media: false,
  });

  if (postResult.ts) {
    await persistChannelPost(sessionId, sessionInfo, postResult.ts, deps);
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
async function handleReject(
  body: BlockAction,
  client: App["client"],
  deps: DmActionsDeps,
): Promise<void> {
  const sessionId = (body.actions[0] as { value: string }).value;
  const session = await deps.getSession(sessionId);

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
async function handleUpdatePost(
  body: BlockAction,
  client: App["client"],
  deps: DmActionsDeps,
): Promise<void> {
  const rawValue = (body.actions[0] as { value: string }).value;
  const resolved = await resolveActionSession(
    rawValue,
    client,
    body.channel?.id,
    body.user.id,
    deps,
  );
  if (!resolved) return;
  const { sessionId, session, sessionInfo } = resolved;

  const answer = latestAssistantText(session);
  const { originChannel } = resolveOrigin(session, sessionInfo);
  const channelPostTs = session.channelPostTs || sessionInfo.channelPostTs;

  if (!answer || !originChannel || !channelPostTs) {
    logger.error(`Cannot update post: missing data for ${sessionId}`);
    return;
  }

  await client.chat.update({
    channel: originChannel,
    ts: channelPostTs,
    blocks: deps.asSlackBlocks(buildAnswerBlocks(session, answer, deps)),
    text: answer,
  });

  await confirmInDm(client, session, ":white_check_mark: Original post updated.");

  logger.debug(`DM-first: updated channel post for session ${sessionId}`);
}

/** Post a new reply to the original thread with the latest answer. */
async function handlePostNew(
  body: BlockAction,
  client: App["client"],
  deps: DmActionsDeps,
): Promise<void> {
  const rawValue = (body.actions[0] as { value: string }).value;
  const resolved = await resolveActionSession(
    rawValue,
    client,
    body.channel?.id,
    body.user.id,
    deps,
  );
  if (!resolved) return;
  const { sessionId, session, sessionInfo } = resolved;

  const answer = latestAssistantText(session);
  const { originChannel, originThreadTs } = resolveOrigin(session, sessionInfo);

  if (!answer || !originChannel || !originThreadTs) {
    logger.error(`Cannot post new reply: missing data for ${sessionId}`);
    return;
  }

  const postResult = await client.chat.postMessage({
    channel: originChannel,
    thread_ts: originThreadTs,
    blocks: deps.asSlackBlocks(buildAnswerBlocks(session, answer, deps)),
    text: answer,
    unfurl_links: false,
    unfurl_media: false,
  });

  if (postResult.ts) {
    await persistChannelPost(sessionId, sessionInfo, postResult.ts, deps);
  }

  await confirmInDm(client, session, ":white_check_mark: New reply posted to the original thread.");

  logger.debug(`DM-first: posted new reply for session ${sessionId}`);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDmActionHandlers(
  app: App,
  deps: DmActionsDeps = defaultDmActionsDeps,
): void {
  // New action ID
  app.action<BlockAction>(/^clack_post_to_\d+$/, async ({ ack, body, client }) => {
    await ack();
    await handlePostTo(body, client, deps);
  });

  // Backward compat: old action ID from sessions created before rename.
  // Can be removed once all Slack messages with old buttons have expired.
  app.action<BlockAction>(/^clack_dm_send_to_thread_\d+$/, async ({ ack, body, client }) => {
    await ack();
    await handlePostTo(body, client, deps);
  });

  app.action<BlockAction>("clack_dm_accept_synthesis", async ({ ack, body, client }) => {
    await ack();
    await handleAcceptSynthesis(body, client, deps);
  });

  app.action<BlockAction>("clack_dm_edit_synthesis", async ({ ack, body, client }) => {
    await ack();
    await handleEditSynthesis(body, client, deps);
  });

  app.view<ViewSubmitAction>("dm_edit_synthesis_modal", async ({ ack, view, client }) => {
    await ack();
    await handleEditSynthesisSubmit(view, client, deps);
  });

  app.action<BlockAction>("clack_dm_reject", async ({ ack, body, client }) => {
    await ack();
    await handleReject(body, client, deps);
  });

  app.action<BlockAction>("clack_dm_update_post", async ({ ack, body, client }) => {
    await ack();
    await handleUpdatePost(body, client, deps);
  });

  app.action<BlockAction>("clack_dm_post_new", async ({ ack, body, client }) => {
    await ack();
    await handlePostNew(body, client, deps);
  });
}
