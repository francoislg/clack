import type { KnownBlock, Block as SlackRawBlock } from "@slack/types";
import type { StreamEvent } from "../../../streaming/types.js";

/** The subset of `SlackStreamer` that `StreamingDelivery` depends on. Depending on this
 *  interface (rather than the concrete class) keeps the handler decoupled and lets tests pass a
 *  structural mock. The real `SlackStreamer` satisfies it. */
export interface StreamerLike {
  start(): Promise<boolean>;
  handleEvent(event: StreamEvent): void;
  stop(opts?: { markdownText?: string; blocks?: (KnownBlock | SlackRawBlock)[] }): Promise<void>;
  getMessageTs(): string | undefined;
  getAllMessageTss(): string[];
  readonly hasFailed: boolean;
}

/** The final content a handler lands. Either structured `blocks` (submit_response) or raw
 *  `markdownText` (a turn that ended without submit_response). `suppressUnfurls` mirrors the
 *  `submit_response.suppress_unfurls` field. */
export interface DeliveryPayload {
  blocks?: (KnownBlock | SlackRawBlock)[];
  markdownText?: string;
  suppressUnfurls?: boolean;
}

/** Result of landing the final answer. `notified` is true when the delivery itself produced a
 *  Slack notification (a real `chat.postMessage`), so the orchestrator can skip a redundant ping.
 *  A streaming in-place finalize edits a message (no notification) → `notified: false`. */
export type DeliveryResult =
  | { ok: true; ts?: string; notified: boolean }
  | { ok: false; error: string };

/**
 * A per-turn delivery strategy: it owns ONLY the progress surface and how the final primary
 * blocks land. The mode-agnostic concerns (already-delivered guard, reactions, follower
 * delivery, post_to auto-execute, the response-ping decision) stay in the orchestrator and
 * operate on the `ts` this returns.
 *
 * Selected at turn start from `session.deliveryMode` and swappable mid-run via `setDelivery`
 * (`windDown({ discard: true })` on the old handler, then `windUp()` on the new one).
 *
 * The four-verb shape is deliberately minimal so a future `EditMessageDelivery` (post a
 * placeholder, throttled `chat.update` on each event, `chat.update` the final blocks,
 * `chat.delete` on discard) drops in without touching the orchestrator.
 */
export interface DeliveryHandler {
  /** Open the progress surface (post + start the live card, or nothing). */
  windUp(): Promise<void>;
  /** Apply a progress tick to the surface. */
  handleEvent(event: StreamEvent): void;
  /** Land the final answer and return its `ts`. */
  deliver(payload: DeliveryPayload): Promise<DeliveryResult>;
  /** Close the surface WITHOUT delivering. `discard: true` removes any messages the surface
   *  opened (skip / cancel / switch-away); `discard: false` (default) just freezes it in place
   *  (error / safety net). Idempotent. */
  windDown(opts?: { discard?: boolean }): Promise<void>;
}
