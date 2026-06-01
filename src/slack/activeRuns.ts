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

/**
 * Per-thread critical-section serializer. The active-runs `register`/`getByThread` pair is
 * a synchronous set-if-absent, but the Slack handler's "consult registry → spawn fresh run"
 * decision is NOT synchronous: it consults near the top of `processMessage` and only claims
 * the slot much later (after session setup, delivery setup, and `streamer.start()` — several
 * awaited round-trips), inside `askClaude`. Two messages on the same thread arriving in that
 * gap would both observe an empty slot and each spawn a run + streamer. This lock closes the
 * gap: it serializes the consult-and-claim per `(channelId, threadTs)` so a later invocation
 * cannot enter until the earlier one has registered its run (or queued onto an existing one).
 *
 * The lock is released via the `release` callback the section passes to the run — typically
 * `askClaude`'s `onRegistered` hook, fired the instant the slot is claimed. It is therefore
 * held only across setup (~the registration window), NOT for the run's full duration; mid-run
 * follow-ups still take the fast `sendUpdate` path. As a safety net the gate also opens when
 * the section's promise settles, so an early throw before registration can never deadlock the
 * chain. The promise returned to the caller still resolves at section completion.
 */
const threadLocks = new Map<string, Promise<void>>();

export function withThreadLock<T>(
  channelId: string,
  threadTs: string,
  fn: (release: () => void) => Promise<T>,
): Promise<T> {
  const key = makeThreadKey(channelId, threadTs);
  const prev = threadLocks.get(key) ?? Promise.resolve();

  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });

  // The next section for this key waits on THIS section's gate, which opens at registration
  // time (via `release`), not at run completion. `gate` only ever resolves, so the lock chain
  // never rejects — a failing `fn` rejects only the caller's promise below, not the tail.
  const tail = prev.then(() => gate);
  threadLocks.set(key, tail);
  tail.finally(() => {
    // Drop the entry once our gate has opened, unless a later section has already queued
    // behind us (in which case it owns the tail). `gate` never rejects, so no lost rejection.
    if (threadLocks.get(key) === tail) threadLocks.delete(key);
  });

  return prev.then(async () => {
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        openGate();
      }
    };
    try {
      return await fn(release);
    } finally {
      release();
    }
  });
}

/** Test-only: clear all entries. Not exported from index. */
export function _resetForTesting(): void {
  registry.clear();
  threadLocks.clear();
}

/** Returns the number of active runs. */
export function size(): number {
  return registry.size;
}
