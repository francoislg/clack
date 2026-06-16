import type { DeliveryHandler, DeliveryResult } from "./types.js";

/**
 * Fully-silent delivery: posts nothing. Every verb is a no-op and `deliver` reports success
 * with `notified: true` (so the orchestrator skips its follow-up ping). Used for runs marked
 * `silent` — the answer is intentionally not delivered to Slack; any side effects (e.g. an
 * auto-executed change) still run because they read the staged intents, not the posted message.
 */
export class NullDelivery implements DeliveryHandler {
  async windUp(): Promise<void> {}

  handleEvent(): void {}

  async deliver(): Promise<DeliveryResult> {
    return { ok: true as const, ts: undefined, notified: true };
  }

  async windDown(): Promise<void> {}
}
