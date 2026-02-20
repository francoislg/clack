import type { App } from "@slack/bolt";
import { logger } from "../logger.js";
import type { ClaudeResponse } from "../claude.js";
import type { SessionContext } from "../sessions.js";
import { updateSession } from "../sessions.js";
import { getStructuredResponseBlocks } from "./blocks.js";
import { setSessionInfo } from "./state.js";


/** Actions for the synthesis message (before posting to channel) */
export function getDmSynthesisActions(sessionId: string) {
  return [
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          text: { type: "plain_text" as const, text: "Accept", emoji: true },
          style: "primary" as const,
          action_id: "clack_dm_accept_synthesis",
          value: sessionId,
        },
        {
          type: "button" as const,
          text: { type: "plain_text" as const, text: "Edit", emoji: true },
          action_id: "clack_dm_edit_synthesis",
          value: sessionId,
        },
        {
          type: "button" as const,
          text: { type: "plain_text" as const, text: "Reject", emoji: true },
          style: "danger" as const,
          action_id: "clack_dm_reject",
          value: sessionId,
        },
      ],
    },
  ];
}

/** Actions for post-accept synthesis (update existing or post new) */
export function getDmPostAcceptActions(sessionId: string) {
  return [
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          text: { type: "plain_text" as const, text: "Update original post", emoji: true },
          style: "primary" as const,
          action_id: "clack_dm_update_post",
          value: sessionId,
        },
        {
          type: "button" as const,
          text: { type: "plain_text" as const, text: "Post new reply", emoji: true },
          action_id: "clack_dm_post_new",
          value: sessionId,
        },
        {
          type: "button" as const,
          text: { type: "plain_text" as const, text: "Cancel", emoji: true },
          style: "danger" as const,
          action_id: "clack_dm_reject",
          value: sessionId,
        },
      ],
    },
  ];
}

/**
 * Open a DM with the user, post the investigation notice, and return DM coordinates.
 */
export async function postDmInvestigationNotice(
  client: App["client"],
  userId: string,
  originChannel: string,
  originThreadTs: string,
  sessionId: string
): Promise<{ dmChannel: string; dmThreadTs: string } | null> {
  try {
    // Get permalink for the original message
    const permalinkResult = await client.chat.getPermalink({
      channel: originChannel,
      message_ts: originThreadTs,
    });
    const permalink = permalinkResult.permalink || `(could not generate link)`;

    // Open DM conversation
    const conversation = await client.conversations.open({ users: userId });
    const dmChannel = conversation.channel?.id;
    if (!dmChannel) {
      logger.error("Failed to open DM conversation with user");
      return null;
    }

    // Post investigation notice (this becomes the DM thread anchor)
    const result = await client.chat.postMessage({
      channel: dmChannel,
      text: `Looking into this message: ${permalink}. I'll reply here when ready.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:mag: Looking into <${permalink}|this message>. I'll reply here when ready.`,
          },
        },
      ],
    });

    const dmThreadTs = result.ts;
    if (!dmThreadTs) {
      logger.error("Failed to get DM message timestamp");
      return null;
    }

    return { dmChannel, dmThreadTs };
  } catch (error) {
    logger.error("Failed to post DM investigation notice:", error);
    return null;
  }
}

/**
 * Post the answer as a thread reply in the DM with action buttons.
 */
export async function postDmThreadReply(
  client: App["client"],
  dmChannel: string,
  dmThreadTs: string,
  session: SessionContext,
  response: ClaudeResponse
): Promise<void> {
  const answerText = response.answer;

  // Use Claude's rendered blocks directly (Claude controls actions via delivery context)
  let blocks: Record<string, unknown>[];
  if (response.response) {
    blocks = response.renderedBlocks
      ? [...(response.renderedBlocks as Record<string, unknown>[])]
      : getStructuredResponseBlocks(response.response, session.sessionId);
  } else {
    blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: answerText },
      },
    ];
  }

  // Add instruction context block before the action buttons
  const dividerIndex = blocks.findIndex(b => b.type === "divider");
  const instructionBlock = {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "_Reply in this thread to refine, or click a button below._",
      },
    ],
  };

  if (dividerIndex >= 0) {
    // Insert after the divider, before action blocks
    blocks.splice(dividerIndex + 1, 0, instructionBlock);
  } else {
    // No divider (no actions from Claude) — append instruction at the end
    blocks.push({ type: "divider" }, instructionBlock);
  }

  await client.chat.postMessage({
    channel: dmChannel,
    thread_ts: dmThreadTs,
    blocks: blocks as any[],
    text: answerText,
  });
}

/**
 * Store DM coordinates in both session context and in-memory session info.
 */
export async function storeDmCoordinates(
  sessionId: string,
  dmChannel: string,
  dmThreadTs: string,
  originChannel: string,
  originThreadTs: string
): Promise<void> {
  // Update persisted session
  await updateSession(sessionId, {
    dmChannel,
    dmThreadTs,
    originChannel,
    originThreadTs,
  });

  // Update in-memory session info
  const currentInfo = (await import("./state.js")).getSessionInfo(sessionId);
  if (currentInfo) {
    setSessionInfo(sessionId, {
      ...currentInfo,
      dmChannel,
      dmThreadTs,
      originChannel,
      originThreadTs,
    });
  }
}
