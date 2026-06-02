import type { ClaudeRunHandle, ClaudeRunStatus } from "./runHandle.js";

/**
 * Test-only fake `ClaudeRunHandle` with mutable status and call recorders. Lets test code
 * configure the run's lifecycle (start as `running`, flip to `stopped` on `stop()`) and
 * assert which `sendUpdate` / `stop` calls happened.
 *
 * Tests that don't care about a particular tracker can just ignore it.
 */
export interface FakeRunHandle extends ClaudeRunHandle {
  status: ClaudeRunStatus;
  readonly sendUpdateCalls: ReadonlyArray<string>;
  readonly stopCalls: ReadonlyArray<string | undefined>;
}

/**
 * Build a fake handle. The default status is `"running"` so tests start with a live run.
 * Calls are recorded into `sendUpdateCalls` / `stopCalls`. `stop()` flips status to
 * `"stopped"` (matching the real handle's terminal-state semantics).
 */
export function makeFakeRunHandle(initialStatus: ClaudeRunStatus = "running"): FakeRunHandle {
  const sendUpdateCalls: string[] = [];
  const stopCalls: Array<string | undefined> = [];
  const handle: FakeRunHandle = {
    sendUpdate: async (text: string) => {
      sendUpdateCalls.push(text);
    },
    stop: async (reason?: string) => {
      stopCalls.push(reason);
      handle.status = "stopped";
    },
    futureResponse: Promise.resolve({ success: true, answer: "" }),
    status: initialStatus,
    hasPendingInput: () => false,
    consumePendingPushedTexts: () => [],
    hasDelivered: () => false,
    sendUpdateCalls,
    stopCalls,
  };
  return handle;
}
