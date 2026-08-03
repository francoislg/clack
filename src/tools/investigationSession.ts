import { getSession, type SessionContext } from "../sessions.js";
import { errorResult } from "./helpers.js";
import type { FollowedThread } from "../investigations/types.js";

type ErrorEnvelope = ReturnType<typeof errorResult>;

export type InvestigationSessionResult =
  | { ok: true; session: SessionContext; followedThreads: FollowedThread[] }
  | { ok: false; error: ErrorEnvelope };

/**
 * Load the current session and confirm it is an investigation (carries `followedThreads`).
 * Shared by every investigation lifecycle tool so the guard — and its Claude-facing error —
 * stay identical. Returns the followed-thread array pre-narrowed for the ok branch.
 */
export async function requireInvestigationSession(
  sessionId: string,
): Promise<InvestigationSessionResult> {
  const session = await getSession(sessionId);
  if (!session?.followedThreads) {
    return { ok: false, error: errorResult("This is not an investigation session.") };
  }
  return { ok: true, session, followedThreads: session.followedThreads };
}
