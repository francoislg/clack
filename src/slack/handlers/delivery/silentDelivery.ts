import type { App } from "@slack/bolt";
import { notificationText } from "../../messagePoster.js";
import { unfurlOptions } from "../../unfurlOptions.js";
import { logger } from "../../../logger.js";
import { errorMessage } from "../../../errors.js";
import type { DeliveryHandler, DeliveryPayload, DeliveryResult } from "./types.js";

export interface SilentDeliveryOptions {
  client: App["client"];
  targetChannel: string;
  /** Records the posted ts as the session's `responseTs` so thread replies can find the
   *  session (a silent post lands top-level, with no thread anchor of its own). Called only
   *  for a structured (`blocks`) delivery, matching the prior direct-delivery behavior. */
  recordResponseTs: (ts: string) => Promise<void>;
}

/**
 * Silent delivery: no progress surface. The final answer lands via a single `chat.postMessage`
 * to the channel (no `thread_ts`), which notifies on its own (`notified: true`). `windUp`,
 * `handleEvent`, and `windDown` are all no-ops — there is nothing to open, update, or tear down.
 */
export class SilentDelivery implements DeliveryHandler {
  constructor(private readonly opts: SilentDeliveryOptions) {}

  async windUp(): Promise<void> {}

  handleEvent(): void {}

  async deliver(payload: DeliveryPayload): Promise<DeliveryResult> {
    const { client, targetChannel, recordResponseTs } = this.opts;
    try {
      const result = await client.chat.postMessage({
        channel: targetChannel,
        text: payload.markdownText ?? notificationText(payload.blocks ?? []),
        ...(payload.blocks && { blocks: payload.blocks }),
        ...unfurlOptions(payload.suppressUnfurls),
      });
      if (payload.blocks && result.ts) {
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
