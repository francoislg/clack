import type { App } from "@slack/bolt";
import { notificationText } from "../../messagePoster.js";
import { unfurlOptions } from "../../unfurlOptions.js";
import { logger } from "../../../logger.js";
import { errorMessage } from "../../../errors.js";
import type { DeliveryHandler, DeliveryPayload, DeliveryResult } from "./types.js";

export interface SilentDeliveryOptions {
  client: App["client"];
  targetChannel: string;
  /** The turn's thread anchor. When set, the silent post lands in that thread (`thread_ts`),
   *  mirroring the streaming handler; when absent, it lands at channel top level. Progress
   *  reporting and landing target are independent — silent suppresses the card, not the thread. */
  targetThread?: string;
  /** Records the posted ts as the session's `responseTs` so replies can find the session. Only
   *  meaningful for a top-level post (no thread anchor) — a threaded post is rediscovered via
   *  `findSessionByThread`. Called only for a structured (`blocks`) top-level delivery. */
  recordResponseTs: (ts: string) => Promise<void>;
}

/**
 * Silent delivery: no progress surface. The final answer lands via a single `chat.postMessage`,
 * threaded under `targetThread` when supplied (else top-level), which notifies on its own
 * (`notified: true`). `windUp`, `handleEvent`, and `windDown` are all no-ops — there is nothing
 * to open, update, or tear down.
 */
export class SilentDelivery implements DeliveryHandler {
  constructor(private readonly opts: SilentDeliveryOptions) {}

  async windUp(): Promise<void> {}

  handleEvent(): void {}

  async deliver(payload: DeliveryPayload): Promise<DeliveryResult> {
    const { client, targetChannel, targetThread, recordResponseTs } = this.opts;
    try {
      const result = await client.chat.postMessage({
        channel: targetChannel,
        ...(targetThread && { thread_ts: targetThread }),
        text: payload.markdownText ?? notificationText(payload.blocks ?? []),
        ...(payload.blocks && { blocks: payload.blocks }),
        ...unfurlOptions(payload.suppressUnfurls),
      });
      // Only a top-level post needs the responseTs anchor; a threaded post is found via its thread.
      if (payload.blocks && result.ts && !targetThread) {
        await recordResponseTs(result.ts);
      }
      return { ok: true as const, ts: result.ts, notified: true };
    } catch (error) {
      logger.error("Silent delivery failed:", error);
      return { ok: false as const, error: errorMessage(error) };
    }
  }

  async windDown(): Promise<void> {}
}
