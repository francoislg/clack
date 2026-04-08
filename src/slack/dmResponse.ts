import { updateSession, type SessionContext } from "../sessions.js";
import { activeSessions, type SessionInfo } from "./activeSessions.js";

export interface DmResponseDeps {
  updateSession: (
    sessionId: string,
    updates: Partial<SessionContext>,
  ) => Promise<SessionContext | null>;
  getSessionInfo: (sessionId: string) => SessionInfo | undefined;
  setSessionInfo: (sessionId: string, info: SessionInfo) => void;
}

export const defaultDmResponseDeps: DmResponseDeps = {
  updateSession,
  getSessionInfo: (sessionId: string) => activeSessions.get(sessionId),
  setSessionInfo: (sessionId: string, info: SessionInfo) => activeSessions.set(sessionId, info),
};

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
 * Store DM coordinates in both session context and in-memory session info.
 */
export async function storeDmCoordinates(
  sessionId: string,
  dmChannel: string,
  dmThreadTs: string,
  originChannel: string,
  originThreadTs: string,
  deps: DmResponseDeps = defaultDmResponseDeps,
): Promise<void> {
  // Update persisted session
  await deps.updateSession(sessionId, {
    dmChannel,
    dmThreadTs,
    originChannel,
    originThreadTs,
  });

  // Update in-memory session info
  const currentInfo = deps.getSessionInfo(sessionId);
  if (currentInfo) {
    deps.setSessionInfo(sessionId, {
      ...currentInfo,
      dmChannel,
      dmThreadTs,
      originChannel,
      originThreadTs,
    });
  }
}
