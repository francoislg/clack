import { logger } from "../logger.js";
import type { ClaudeRunHandle } from "../claude/runHandle.js";

/**
 * In-memory registry of active `ClaudeRunHandle`s.
 *
 * Each handle can be registered under multiple lookup keys so the queueing semantics work
 * uniformly across surfaces:
 *   - **Thread key** `{channelId}:{threadTs}` — for threaded conversations (mentions,
 *     reactions, replies). For top-level non-threaded messages this defaults to messageTs.
 *   - **DM key** `dm:{channelId}:{userId}` — for direct messages, where each new message
 *     from the same user is its own top-level message with a fresh `messageTs`. Without a
 *     stable per-user key, follow-up DMs would never match a live run.
 *
 * Invariant: at most one handle per key. `register` returns false if any of the requested
 * keys is already occupied. The handle is responsible for calling `unregister` when it
 * terminates (typically via its `onTerminal` hook).
 *
 * Replaces the prior `inFlightRequests` registry.
 */

function makeThreadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

function makeDmKey(channelId: string, userId: string): string {
  return `dm:${channelId}:${userId}`;
}

const registry = new Map<string, ClaudeRunHandle>();

/**
 * Tracks every key a handle was registered under so `unregister` can clean them all up
 * even when the caller only knows the primary (thread) key. Keyed by the handle reference.
 */
const handleKeys = new WeakMap<ClaudeRunHandle, string[]>();

export interface RegisterOptions {
  channelId: string;
  threadTs: string;
  /** Optional: when present, the handle is also indexed under `dm:{channelId}:{userId}`. */
  dmUserId?: string;
}

/**
 * Insert a handle into the registry under all applicable keys. Returns `true` on success;
 * `false` if any of the requested keys is already occupied (and rolls back partial inserts
 * so the registry stays consistent). The handle is responsible for calling `unregister`
 * when it terminates.
 */
export function register(opts: RegisterOptions, handle: ClaudeRunHandle): boolean {
  const keys = [makeThreadKey(opts.channelId, opts.threadTs)];
  if (opts.dmUserId) {
    keys.push(makeDmKey(opts.channelId, opts.dmUserId));
  }

  for (const key of keys) {
    if (registry.has(key)) {
      logger.debug(`active-runs: slot already occupied for ${key}`);
      return false;
    }
  }

  for (const key of keys) {
    registry.set(key, handle);
  }
  handleKeys.set(handle, keys);
  logger.debug(`active-runs: registered ${keys.join(", ")}`);
  return true;
}

/** Look up the active run for a thread. Returns `undefined` if no run is active. */
export function getByThread(channelId: string, threadTs: string): ClaudeRunHandle | undefined {
  return registry.get(makeThreadKey(channelId, threadTs));
}

/**
 * Look up the active run for a DM by `(channelId, userId)`. Returns `undefined` if the
 * handle wasn't registered with a `dmUserId` or no run is active in this DM.
 */
export function getByDm(channelId: string, userId: string): ClaudeRunHandle | undefined {
  return registry.get(makeDmKey(channelId, userId));
}

/**
 * Look up the active run for an incoming Slack message. Tries the thread key first; if
 * the channel is a DM (channel id starts with `D`) and the user id is known, falls back
 * to the per-user DM key. This collapses the lookup-with-DM-fallback pattern used by
 * every Slack handler that needs to detect whether a run is in flight for the
 * conversation the new message belongs to.
 */
export function getForChannelMessage(
  channelId: string,
  threadTs: string,
  userId: string | undefined,
): ClaudeRunHandle | undefined {
  const byThread = getByThread(channelId, threadTs);
  if (byThread) return byThread;
  if (channelId.startsWith("D") && userId) {
    return getByDm(channelId, userId);
  }
  return undefined;
}

/**
 * Remove every key the handle was registered under. The `expected` parameter prevents
 * accidental unregistration of a newer handle that took the slot after the original
 * settled. Idempotent.
 */
export function unregister(handle: ClaudeRunHandle): void {
  const keys = handleKeys.get(handle);
  if (!keys) return;
  for (const key of keys) {
    if (registry.get(key) === handle) {
      registry.delete(key);
    }
  }
  handleKeys.delete(handle);
  logger.debug(`active-runs: unregistered ${keys.join(", ")}`);
}

/** Test-only: clear all entries. Not exported from index. */
export function _resetForTesting(): void {
  registry.clear();
}

/** Returns the number of active runs (counts unique handles, not keys). */
export function size(): number {
  // A handle can occupy multiple keys; count unique handle references via the WeakMap by
  // walking the registry values into a Set.
  return new Set(registry.values()).size;
}
