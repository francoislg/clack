import { logger } from "../logger.js";
import { getByThread as getActiveRunByThread } from "./activeRuns.js";
import { findSessionByThread, setAttentionLevel, isEngaged } from "../sessions.js";
import { getActiveChange } from "../changes/activeState.js";
import { cancelQueuedSession } from "../workers/index.js";
import type { ChangeStatus } from "../changes/types.js";

const TERMINAL_STATUSES: ReadonlyArray<ChangeStatus> = ["completed", "failed", "cancelled"];

export interface StopResult {
  queryAborted: number;
  workerAborted: boolean;
  /**
   * True when the session was waiting on a worker (`pool.acquire` enqueued, no
   * `ClaudeRunHandle` yet) and we cancelled the queue entry instead of stopping
   * a running handle. Mutually exclusive with `workerAborted`.
   */
  queuedCancelled: boolean;
  sessionDisengaged: boolean;
}

export interface StopPipelineDeps {
  getActiveRunByThread: typeof getActiveRunByThread;
  findSessionByThread: typeof findSessionByThread;
  getActiveChange: typeof getActiveChange;
  setAttentionLevel: typeof setAttentionLevel;
  cancelQueuedSession: typeof cancelQueuedSession;
}

export const defaultStopPipelineDeps: StopPipelineDeps = {
  getActiveRunByThread,
  findSessionByThread,
  getActiveChange,
  setAttentionLevel,
  cancelQueuedSession,
};

/**
 * Stop any active Clack work for a thread.
 *
 * Called by both the stop-reaction handler and inline stop-emoji detection. Behaviour is
 * identical across surfaces; only the `reason` string differs for downstream display.
 *
 * Actions performed (all idempotent, all best-effort):
 *   1. Stop the active query-side `ClaudeRunHandle` for the thread (if any).
 *   2. Stop the worker-side `ClaudeRunHandle` on `activeChange` (if any), setting
 *      `cancelledBy` so the existing cancellation-display path renders.
 *   3. Disengage the thread's session (`attentionLevel = "off"`).
 */
export async function stopThread(
  channelId: string,
  threadTs: string,
  triggeredByUserId: string,
  reason: string,
  deps: StopPipelineDeps = defaultStopPipelineDeps,
): Promise<StopResult> {
  const result: StopResult = {
    queryAborted: 0,
    workerAborted: false,
    queuedCancelled: false,
    sessionDisengaged: false,
  };

  // 1. Query-side: stop the live run if one is registered for this thread.
  const queryHandle = deps.getActiveRunByThread(channelId, threadTs);
  if (queryHandle && queryHandle.status === "running") {
    await queryHandle.stop(reason);
    result.queryAborted = 1;
  }

  // 2. Worker-side abort + 3. session disengage need the session.
  const session = await deps.findSessionByThread(channelId, threadTs);

  if (session) {
    const activeChange = deps.getActiveChange(session.sessionId);
    if (activeChange && !TERMINAL_STATUSES.includes(activeChange.status)) {
      if (activeChange.handle && activeChange.handle.status === "running") {
        if (!activeChange.cancelledBy) {
          activeChange.cancelledBy = { userId: triggeredByUserId, reason };
        }
        await activeChange.handle.stop(reason);
        result.workerAborted = true;
      } else {
        // No live handle — the session might be waiting on a worker (reusable
        // mode, pool at capacity → queued). Cancel the queue entry so the
        // awaiter in startChangeWorkflow rejects with `Cancelled` and the
        // session unwinds cleanly.
        if (deps.cancelQueuedSession(session.sessionId, reason)) {
          if (!activeChange.cancelledBy) {
            activeChange.cancelledBy = { userId: triggeredByUserId, reason };
          }
          result.queuedCancelled = true;
        }
      }
    }

    if (isEngaged(session)) {
      await deps.setAttentionLevel(session.sessionId, "off");
      result.sessionDisengaged = true;
    }
  }

  logger.info(
    `stopThread channel=${channelId} thread=${threadTs} by=${triggeredByUserId} reason="${reason}" ` +
      `queryAborted=${result.queryAborted} workerAborted=${result.workerAborted} ` +
      `queuedCancelled=${result.queuedCancelled} sessionDisengaged=${result.sessionDisengaged}`,
  );

  return result;
}
