import { logger } from "../logger.js";
import { getSession, parseSessionId } from "../sessions.js";

export interface SessionInfo {
  channelId: string;
  threadTs: string;
  userId: string;
}

const activeSessions = new Map<string, SessionInfo>();

export function getSessionInfo(sessionId: string): SessionInfo | undefined {
  return activeSessions.get(sessionId);
}

export function setSessionInfo(sessionId: string, info: SessionInfo): void {
  activeSessions.set(sessionId, info);
}

export function deleteSessionInfo(sessionId: string): void {
  activeSessions.delete(sessionId);
}

/**
 * Restore SessionInfo from disk if not in memory.
 * If not on disk, attempts to parse sessionId to reconstruct minimal info.
 * Returns the SessionInfo if found or reconstructed, undefined if parsing fails.
 */
export async function restoreSessionInfo(sessionId: string): Promise<SessionInfo | undefined> {
  // Check memory first
  const inMemory = activeSessions.get(sessionId);
  if (inMemory) {
    return inMemory;
  }

  // Try to load from disk
  const session = await getSession(sessionId);
  if (session) {
    // Handle backward compatibility: older sessions might not have threadTs
    const threadTs = session.threadTs || session.messageTs;

    const info: SessionInfo = {
      channelId: session.channelId,
      threadTs,
      userId: session.userId,
    };

    // Cache in memory for future use
    activeSessions.set(sessionId, info);
    logger.debug(`Restored session ${sessionId} from disk`);

    return info;
  }

  // Session not on disk - try to parse sessionId to reconstruct minimal info
  logger.debug(`Session ${sessionId} not found on disk, attempting to parse sessionId`);
  const parsed = parseSessionId(sessionId);
  if (!parsed) {
    return undefined;
  }

  // Use messageTs as threadTs fallback (works for top-level messages)
  const info: SessionInfo = {
    channelId: parsed.channelId,
    threadTs: parsed.messageTs,
    userId: parsed.userId,
  };

  // Cache in memory
  activeSessions.set(sessionId, info);
  logger.debug(`Reconstructed session info for ${sessionId} from parsed sessionId`);

  return info;
}
