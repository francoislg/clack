import type { App } from "@slack/bolt";
import type { StreamEvent } from "../../../streaming/types.js";
import { notificationText } from "../../messagePoster.js";
import { unfurlOptions } from "../../unfurlOptions.js";
import { logger } from "../../../logger.js";
import { errorMessage } from "../../../errors.js";
import type { DeliveryHandler, DeliveryPayload, DeliveryResult, StreamerLike } from "./types.js";

export interface StreamingDeliveryOptions {
  client: App["client"];
  targetChannel: string;
  targetThread: string;
  /** Constructs (but does not start) the streamer. Async so its bot-fallback `auth.test` runs
   *  only when a card is actually opened. Called lazily in `windUp` so a handler installed
   *  mid-run opens a fresh card at the switch point. */
  makeStreamer: () => Promise<StreamerLike>;
}

/**
 * Live-streaming delivery: a `SlackStreamer` card that opens at `windUp`, updates on each
 * event, and finalizes in place at `deliver`. Its `hasFailed` → `chat.postMessage` fallback is
 * hidden inside `deliver`, which returns a `ts` regardless. `deliver` reports `notified: false`
 * on an in-place finalize (a message edit triggers no Slack notification) so the orchestrator
 * can decide whether to send a follow-up ping.
 */
export class StreamingDelivery implements DeliveryHandler {
  private streamer: StreamerLike | null = null;

  constructor(private readonly opts: StreamingDeliveryOptions) {}

  async windUp(): Promise<void> {
    // windUp never throws: opening the card is best-effort. If makeStreamer (which runs an
    // auth.test) or start() fails, degrade to one-shot posting by leaving the streamer null —
    // deliver() then falls back to chat.postMessage. This keeps every call site (turn start,
    // mid-run switch, finally net) safe without each guarding the call.
    try {
      this.streamer = await this.opts.makeStreamer();
      const started = await this.streamer.start();
      if (!started) {
        logger.warn("Stream failed to start, will fall back to one-shot posting");
      }
    } catch (error) {
      logger.warn("Failed to open streaming surface, falling back to one-shot posting:", error);
      this.streamer = null;
    }
  }

  handleEvent(event: StreamEvent): void {
    this.streamer?.handleEvent(event);
  }

  async deliver(payload: DeliveryPayload): Promise<DeliveryResult> {
    const { client, targetChannel, targetThread } = this.opts;
    try {
      if (this.streamer && !this.streamer.hasFailed) {
        await this.streamer.stop({
          ...(payload.blocks && { blocks: payload.blocks }),
          ...(payload.markdownText && { markdownText: payload.markdownText }),
        });
        if (!this.streamer.hasFailed) {
          // An in-place finalize is a message edit — it does NOT ping the user.
          return { ok: true as const, ts: this.streamer.getMessageTs(), notified: false };
        }
        // Stream stop failed — fall through to chat.postMessage.
      }

      const result = await client.chat.postMessage({
        channel: targetChannel,
        thread_ts: targetThread,
        text: payload.markdownText ?? notificationText(payload.blocks ?? []),
        ...(payload.blocks && { blocks: payload.blocks }),
        ...unfurlOptions(payload.suppressUnfurls),
      });
      // A real post notifies on its own.
      return { ok: true as const, ts: result.ts, notified: true };
    } catch (error) {
      logger.error("Streaming delivery failed:", error);
      return { ok: false as const, error: errorMessage(error) };
    }
  }

  async windDown(opts?: { discard?: boolean }): Promise<void> {
    await this.streamer?.stop();
    if (opts?.discard) {
      for (const ts of this.streamer?.getAllMessageTss() ?? []) {
        try {
          await this.opts.client.chat.delete({ channel: this.opts.targetChannel, ts });
        } catch (error) {
          logger.warn("Failed to remove streamer message:", error);
        }
      }
    }
    // Drop the reference so a late event after teardown (e.g. during a mid-run switch) hits the
    // `?.` no-op rather than a stopped streamer.
    this.streamer = null;
  }
}
