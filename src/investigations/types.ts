/**
 * Shared types for the split-investigations feature. Kept dependency-light so the config
 * layer, the session layer, and the Slack layer can all import from here without cycles.
 */

export type FollowMode = "follow" | "followAndInteract";

/**
 * A thread that an open investigation follows read-only. Persisted on the owning
 * {@link SessionContext} as `followedThreads[]` — the session is the source of truth for the
 * per-thread cursor and pending count. The routing index in `data/state/investigations.json`
 * carries only a projection (see {@link OpenInvestigationEntry}).
 */
export interface FollowedThread {
  channel: string;
  threadTs: string;
  mode: FollowMode;
  /**
   * Newest side-thread ts whose content has been injected into the main session. `"0"` until
   * the first drain, so the first round drains the thread's full history.
   */
  lastInjectedTs: string;
  /** `follow`-mode: side-thread messages seen since `lastInjectedTs`, surfaced piggyback next round. */
  pendingCount: number;
  /** Slack user id who added this thread (reactor/requester at bootstrap, or the `follow_thread` caller). */
  addedBy: string;
}

export type InvestigationSurface = "channel" | "dm";

/**
 * Routing/index projection of an open investigation, stored in
 * `data/state/investigations.json` under one key per FOLLOWED thread
 * (`${channel}:${threadTs}`). The authoritative followed-thread state (cursors, counts,
 * modes) lives on the session; this projection exists only for O(1) event routing, dedup,
 * and the Home Tab open-investigations list.
 */
export interface OpenInvestigationEntry {
  sessionId: string;
  /** Channel (or DM channel id) hosting the investigation's main thread. */
  mainChannel: string;
  /** Parent message ts of the main investigation thread. */
  mainThreadTs: string;
  surface: InvestigationSurface;
  /** Slack user id who started the investigation. */
  startedBy: string;
  /** Optional short subject the classifier and delivery context key on. */
  subject?: string;
}

export interface InvestigationsState {
  /** Admin-configured investigations channel; `null` until picked in the Home Tab. */
  channel: string | null;
  /** Followed-thread key `${channel}:${threadTs}` → the open investigation it feeds. */
  open: Record<string, OpenInvestigationEntry>;
}

/** One row per open investigation (deduped across its followed-thread keys). */
export interface InvestigationSummary {
  sessionId: string;
  mainChannel: string;
  mainThreadTs: string;
  surface: InvestigationSurface;
  startedBy: string;
  subject?: string;
  followedCount: number;
}

/** Canonical routing key for a (channel, threadTs) pair. */
export function followedThreadKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}
