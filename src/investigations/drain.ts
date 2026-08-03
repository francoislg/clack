/**
 * Drain-on-round: fetch each followed thread's messages newer than its `lastInjectedTs`
 * cursor, format them (attributed + timestamped) for injection into the investigation's next
 * turn, and advance the cursors. Events are only triggers; this is the single content
 * acquisition path, which makes downtime lossless — a message missed as a live event is still
 * drained here on the next round.
 */

import { logger } from "../logger.js";
import { isBotMessage } from "../slack/isBotMessage.js";
import type { FollowedThread } from "./types.js";

/** Minimal slice of the Slack client the drain needs — keeps this unit testable with a fake. */
export interface DrainClient {
  conversations: {
    replies(args: {
      channel: string;
      ts: string;
      oldest?: string;
      inclusive?: boolean;
      limit?: number;
    }): Promise<{ messages?: DrainMessage[] }>;
  };
}

export interface DrainMessage {
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  subtype?: string;
}

export interface DrainOptions {
  /** Bot's own user id — its posts (and any bot message) never count as deltas. */
  botUserId?: string;
  /** Resolve a user id to a display name for attribution; falls back to the raw id. */
  resolveName?: (userId: string) => string | undefined;
  /** Max replies fetched per thread per round. */
  limit?: number;
}

export interface DrainResult {
  /** Attributed, timestamped context block; empty string when nothing was drained. */
  injectedContext: string;
  /** Followed threads with advanced cursors and reset pending counts. */
  updatedThreads: FollowedThread[];
  /** True when at least one new message was injected. */
  drainedAny: boolean;
}

interface ThreadDrain {
  thread: FollowedThread;
  lines: string[];
  newCursor: string;
  drainedCount: number;
}

async function drainOne(
  client: DrainClient,
  thread: FollowedThread,
  opts: DrainOptions,
): Promise<ThreadDrain> {
  const fromZero = thread.lastInjectedTs === "0" || thread.lastInjectedTs === "";
  let messages: DrainMessage[];
  try {
    const replies = await client.conversations.replies({
      channel: thread.channel,
      ts: thread.threadTs,
      ...(fromZero ? {} : { oldest: thread.lastInjectedTs }),
      inclusive: false,
      limit: opts.limit ?? 50,
    });
    messages = replies.messages ?? [];
  } catch (err) {
    // A single unreachable thread (deleted, permissions revoked) must not crash the whole
    // round — this drain runs inside the per-turn refresh hook. Skip it, keep the cursor.
    logger.warn(
      `investigations drain: failed to fetch ${thread.channel}:${thread.threadTs}: ${String(err)}`,
    );
    return { thread, lines: [], newCursor: thread.lastInjectedTs, drainedCount: 0 };
  }
  let newCursor = thread.lastInjectedTs;
  const lines: string[] = [];
  for (const m of messages) {
    if (!m.ts) continue;
    // The thread root is returned by replies; it is not new activity.
    if (m.ts === thread.threadTs) continue;
    // `oldest` is inclusive on the Slack side — guard against re-injecting the cursor message.
    if (!fromZero && m.ts <= thread.lastInjectedTs) continue;
    if (m.ts > newCursor) newCursor = m.ts;
    if (
      isBotMessage({
        userId: m.user,
        botId: m.bot_id,
        subtype: m.subtype,
        botUserId: opts.botUserId,
      })
    )
      continue;
    const text = (m.text ?? "").trim();
    if (!text) continue;
    const name = (m.user && opts.resolveName?.(m.user)) || m.user || "unknown";
    lines.push(`  - ${name} (${m.ts}): ${text}`);
  }
  return { thread, lines, newCursor, drainedCount: lines.length };
}

/**
 * Drain every followed thread. Cursors advance to the newest observed ts (so a purely-bot
 * batch still advances the cursor and is not re-scanned), while `pendingCount` resets only
 * when human content was injected.
 */
export async function drainFollowedThreads(
  client: DrainClient,
  threads: FollowedThread[],
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const drains = await Promise.all(threads.map((t) => drainOne(client, t, opts)));
  const sections: string[] = [];
  const updatedThreads: FollowedThread[] = drains.map((d) => {
    if (d.lines.length > 0) {
      sections.push(`[thread in <#${d.thread.channel}>]:\n${d.lines.join("\n")}`);
    }
    return {
      ...d.thread,
      lastInjectedTs: d.newCursor,
      pendingCount: d.drainedCount > 0 ? 0 : d.thread.pendingCount,
    };
  });
  const drainedAny = sections.length > 0;
  const injectedContext = drainedAny
    ? `FOLLOWED THREAD ACTIVITY (read-only sources — never post to these threads):\n${sections.join("\n\n")}`
    : "";
  return { injectedContext, updatedThreads, drainedAny };
}
