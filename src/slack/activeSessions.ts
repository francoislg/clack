import { logger } from "../logger.js";
import { getSession, parseSessionId } from "../sessions.js";

export interface SessionInfo {
  channelId: string;
  threadTs: string;
  userId: string;
  /** Original trigger type, used to build proper Claude options on button clicks. */
  triggerType?: "directMessages" | "mentions" | "reactions";
  /** DM-first: the DM channel ID where the answer was delivered */
  dmChannel?: string;
  /** DM-first: the root DM message timestamp (thread anchor) */
  dmThreadTs?: string;
  /** DM-first: the original channel where the reaction was added */
  originChannel?: string;
  /** DM-first: the original thread timestamp in the channel */
  originThreadTs?: string;
  /** DM-first: timestamp of the accepted message posted to the channel */
  channelPostTs?: string;
}

const store = new Map<string, SessionInfo>();

export const activeSessions = {
  get(sessionId: string): SessionInfo | undefined {
    return store.get(sessionId);
  },

  set(sessionId: string, info: SessionInfo): void {
    store.set(sessionId, info);
  },

  delete(sessionId: string): void {
    store.delete(sessionId);
  },

  /**
   * Restore from disk if not in memory.
   * If not on disk, attempts to parse sessionId to reconstruct minimal info.
   */
  async restore(sessionId: string): Promise<SessionInfo | undefined> {
    const inMemory = store.get(sessionId);
    if (inMemory) {
      return inMemory;
    }

    const session = await getSession(sessionId);
    if (session) {
      const threadTs = session.threadTs || session.messageTs;

      const info: SessionInfo = {
        channelId: session.channelId,
        threadTs,
        userId: session.userId,
        ...(session.triggerType && { triggerType: session.triggerType }),
        ...(session.dmChannel && { dmChannel: session.dmChannel }),
        ...(session.dmThreadTs && { dmThreadTs: session.dmThreadTs }),
        ...(session.originChannel && { originChannel: session.originChannel }),
        ...(session.originThreadTs && { originThreadTs: session.originThreadTs }),
        ...(session.channelPostTs && { channelPostTs: session.channelPostTs }),
      };

      store.set(sessionId, info);
      logger.debug(`Restored session ${sessionId} from disk`);

      return info;
    }

    logger.debug(`Session ${sessionId} not found on disk, attempting to parse sessionId`);
    const parsed = parseSessionId(sessionId);
    if (!parsed) {
      return undefined;
    }

    const info: SessionInfo = {
      channelId: parsed.channelId,
      threadTs: parsed.messageTs,
      userId: parsed.userId,
    };

    store.set(sessionId, info);
    logger.debug(`Reconstructed session info for ${sessionId} from parsed sessionId`);

    return info;
  },

  /** Clear all entries. Useful for testing. */
  clear(): void {
    store.clear();
  },
};
