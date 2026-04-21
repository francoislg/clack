import { logger } from "../logger.js";
import {
  findInFlightByThread,
  deregisterInFlightRequest,
  type InFlightRequest,
} from "./inFlightRequests.js";
import { findSessionByThread, setAutoResponseActive } from "../sessions.js";
import { getActiveChange } from "../changes/activeState.js";
import type { ChangeStatus } from "../changes/types.js";

const TERMINAL_STATUSES: ReadonlyArray<ChangeStatus> = ["completed", "failed", "cancelled"];

export interface StopResult {
  queryAborted: number;
  workerAborted: boolean;
  sessionDisengaged: boolean;
}

export interface StopPipelineDeps {
  findInFlightByThread: (
    channelId: string,
    threadTs: string,
  ) => { key: string; request: InFlightRequest }[];
  deregisterInFlightRequest: (channelId: string, messageTs: string) => void;
  findSessionByThread: typeof findSessionByThread;
  getActiveChange: typeof getActiveChange;
  setAutoResponseActive: typeof setAutoResponseActive;
}

export const defaultStopPipelineDeps: StopPipelineDeps = {
  findInFlightByThread,
  deregisterInFlightRequest,
  findSessionByThread,
  getActiveChange,
  setAutoResponseActive,
};

/**
 * Stop any active Clack work for a thread.
 *
 * This is called by both the stop-reaction handler and the inline stop-emoji
 * detection. Behaviour is identical across surfaces; only the `reason` string
 * differs for downstream display.
 *
 * Actions performed (all idempotent, all best-effort):
 *   1. Abort every in-flight query request for the thread.
 *   2. Abort any in-flight worker execution for the thread's session, setting
 *      `cancelledBy` so the existing cancellation-display path renders.
 *   3. Disengage the thread's session (`autoResponseActive = false`).
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
    sessionDisengaged: false,
  };

  // 1. Query-side: thread-scoped abort sweep.
  const matches = deps.findInFlightByThread(channelId, threadTs);
  for (const { key, request } of matches) {
    deps.deregisterInFlightRequest(channelId, extractMessageTs(key));
    if (!request.abortController.signal.aborted) {
      request.abortController.abort();
      result.queryAborted += 1;
    }
  }

  // 2. Worker-side abort + 3. session disengage need the session.
  const session = await deps.findSessionByThread(channelId, threadTs);

  if (session) {
    const activeChange = deps.getActiveChange(session.sessionId);
    if (
      activeChange?.abortController &&
      !TERMINAL_STATUSES.includes(activeChange.status) &&
      !activeChange.abortController.signal.aborted
    ) {
      if (!activeChange.cancelledBy) {
        activeChange.cancelledBy = { userId: triggeredByUserId, reason };
      }
      activeChange.abortController.abort();
      result.workerAborted = true;
    }

    if (session.autoResponseActive !== false) {
      await deps.setAutoResponseActive(session.sessionId, false);
      result.sessionDisengaged = true;
    }
  }

  logger.info(
    `stopThread channel=${channelId} thread=${threadTs} by=${triggeredByUserId} reason="${reason}" queryAborted=${result.queryAborted} workerAborted=${result.workerAborted} sessionDisengaged=${result.sessionDisengaged}`,
  );

  return result;
}

function extractMessageTs(key: string): string {
  const idx = key.indexOf(":");
  return idx >= 0 ? key.slice(idx + 1) : key;
}
