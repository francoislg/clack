import { logger } from "../logger.js";
import type { ClaudeRunHandle } from "../claude/runHandle.js";

/**
 * In-memory registry of active `ClaudeRunHandle`s, keyed by `(channelId, threadTs)`.
 *
 * For top-level non-threaded messages, `threadTs` defaults to `messageTs`. The Slack
 * assistant API always provides `thread_ts` on user messages, so thread-keyed lookups
 * work for DMs too — we deliberately do NOT collapse multiple DM threads under a per-user
 * key, since that would route a message in one DM thread into a run in a different thread.
 *
 * Invariant: at most one handle per key. `register` returns false if the key is already
 * occupied. The handle is responsible for calling `unregister` when it terminates
 * (typically via its `onTerminal` hook).
 *
 * Replaces the prior `inFlightRequests` registry.
 */

function makeThreadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

const registry = new Map<string, ClaudeRunHandle>();

/** Tracks the key each handle was registered under so `unregister` can find it from the
 * handle reference alone. Keyed by the handle reference (WeakMap so a forgotten handle
 * doesn't leak the registry slot). */
const handleKeys = new WeakMap<ClaudeRunHandle, string>();

export interface RegisterOptions {
  channelId: string;
  threadTs: string;
}

/**
 * Insert a handle into the registry under `(channelId, threadTs)`. Returns `true` on
 * success; `false` if the key is already occupied. The handle is responsible for calling
 * `unregister` when it terminates.
 */
export function register(opts: RegisterOptions, handle: ClaudeRunHandle): boolean {
  const key = makeThreadKey(opts.channelId, opts.threadTs);
  if (registry.has(key)) {
    logger.debug(`active-runs: slot already occupied for ${key}`);
    return false;
  }
  registry.set(key, handle);
  handleKeys.set(handle, key);
  logger.debug(`active-runs: registered ${key}`);
  return true;
}

/** Look up the active run for a thread. Returns `undefined` if no run is active. */
export function getByThread(channelId: string, threadTs: string): ClaudeRunHandle | undefined {
  return registry.get(makeThreadKey(channelId, threadTs));
}

/**
 * Look up the active run for an incoming Slack message. Slack's assistant API and
 * standard threading both supply a `thread_ts` on user messages; for top-level non-
 * threaded triggers, callers pass `messageTs` as `threadTs`. Returns `undefined` when
 * no run is active for this exact thread — DMs are NOT collapsed across threads under
 * a per-user key, since that would route a message in one DM thread into a run in a
 * different thread.
 */
export function getForChannelMessage(
  channelId: string,
  threadTs: string,
  _userId: string | undefined,
): ClaudeRunHandle | undefined {
  return getByThread(channelId, threadTs);
}

/**
 * Remove the handle's registry entry. Idempotent. The key is recovered from the
 * `handleKeys` map so the caller doesn't need to remember it.
 */
export function unregister(handle: ClaudeRunHandle): void {
  const key = handleKeys.get(handle);
  if (!key) return;
  if (registry.get(key) === handle) {
    registry.delete(key);
  }
  handleKeys.delete(handle);
  logger.debug(`active-runs: unregistered ${key}`);
}

/** Test-only: clear all entries. Not exported from index. */
export function _resetForTesting(): void {
  registry.clear();
}

/** Returns the number of active runs. */
export function size(): number {
  return registry.size;
}
