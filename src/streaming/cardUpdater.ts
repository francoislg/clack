import type { App } from "@slack/bolt";
import type { Block, KnownBlock, TaskUpdateChunk } from "@slack/types";
import { notificationText } from "../slack/messagePoster.js";
import { t } from "../i18n/t.js";
import type { SlackStreamerLogger } from "./slackStreamer.js";
import { TaskCardProjection } from "./taskCardProjection.js";

export interface CardUpdaterOptions {
  client: App["client"];
  channel: string;
  logger: SlackStreamerLogger;
  /** Context appended to failure logs. */
  diagnostics: () => object;
}

/**
 * Owns the `chat.update` side of a task card: the projection of every streamed chunk, the
 * message it renders onto, and a coalesced single-flight update loop. Once any update fails
 * the updater stays failed and further flushes are no-ops.
 */
export class CardUpdater {
  private client: App["client"];
  private channel: string;
  private logger: SlackStreamerLogger;
  private diagnostics: () => object;

  private projection = new TaskCardProjection();
  private ts: string | undefined;
  private inFlight: Promise<boolean> | null = null;
  private dirty = false;
  private failed = false;

  constructor(opts: CardUpdaterOptions) {
    this.client = opts.client;
    this.channel = opts.channel;
    this.logger = opts.logger;
    this.diagnostics = opts.diagnostics;
  }

  apply(chunks: TaskUpdateChunk[]): void {
    this.projection.apply(chunks);
  }

  /** The message the card renders onto. */
  attach(ts: string): void {
    this.ts = ts;
  }

  /** Request one more update from the in-flight loop without starting one. */
  markDirty(): void {
    this.dirty = true;
  }

  /** Coalesced single-flight: a call during an in-flight update marks it dirty and shares it.
   *  Resolves false once any update has failed. */
  flush(): Promise<boolean> {
    if (this.failed) return Promise.resolve(false);
    this.dirty = true;
    this.inFlight ??= this.runUpdates().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async whenIdle(): Promise<void> {
    if (this.inFlight) await this.inFlight;
  }

  /** The closing update: the card plus the answer. */
  async finalize(opts?: {
    markdownText?: string;
    blocks?: (KnownBlock | Block)[];
  }): Promise<boolean> {
    await this.whenIdle();
    if (this.failed) return false;
    const title = t("streamer.plan_title");
    const answerBlocks = opts?.blocks ?? [];
    return this.send(opts?.markdownText ?? (notificationText(answerBlocks) || title), [
      this.projection.toPlanBlock(title),
      ...(opts?.markdownText ? [{ type: "markdown" as const, text: opts.markdownText }] : []),
      ...answerBlocks,
    ]);
  }

  private async runUpdates(): Promise<boolean> {
    while (this.dirty && !this.failed) {
      this.dirty = false;
      const title = t("streamer.plan_title");
      await this.send(title, [this.projection.toPlanBlock(title)]);
    }
    return !this.failed;
  }

  private async send(text: string, blocks: (KnownBlock | Block)[]): Promise<boolean> {
    if (!this.ts) return true;
    try {
      await this.client.chat.update({ channel: this.channel, ts: this.ts, text, blocks });
      return true;
    } catch (error) {
      this.logger.error("Failed to update task card:", error, this.diagnostics());
      this.failed = true;
      return false;
    }
  }
}
