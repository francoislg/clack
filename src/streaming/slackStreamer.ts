import type { App } from "@slack/bolt";
import type { Block, KnownBlock, TaskUpdateChunk } from "@slack/types";
import type { ChatStreamer } from "@slack/web-api";
import { logger } from "../logger.js";
import { getToolLabel } from "./toolLabels.js";
import type { StreamEvent } from "./types.js";

export interface SlackStreamerOptions {
  client: App["client"];
  channel: string;
  threadTs: string;
  /** User ID of the recipient (required for channel streams). */
  userId?: string;
  /** Team ID (required for channel streams). Avoids an extra auth.test call if provided. */
  teamId?: string;
}

/**
 * Manages a Slack chat stream with plan blocks for showing Claude's tool call progress.
 *
 * Usage:
 *   const streamer = new SlackStreamer(opts);
 *   await streamer.start();
 *   // Wire to askClaude/runClaude onEvent callback:
 *   streamer.handleEvent(event);
 *   // When done:
 *   await streamer.stop({ blocks });
 */
export class SlackStreamer {
  private client: App["client"];
  private channel: string;
  private threadTs: string;
  private userId: string | undefined;
  private teamId: string | undefined;

  private chatStreamer: ChatStreamer | null = null;
  private taskTitles = new Map<string, string>();
  private thinkingFinalized = false;
  private failed = false;
  private stopped = false;

  private static readonly THINKING_TASK_ID = "__thinking__";

  constructor(opts: SlackStreamerOptions) {
    this.client = opts.client;
    this.channel = opts.channel;
    this.threadTs = opts.threadTs;
    this.userId = opts.userId;
    this.teamId = opts.teamId;
  }

  /**
   * Start the chat stream. Call this before handling any events.
   * Immediately shows a "Thinking" task so the user gets instant feedback.
   * Returns false if the stream failed to start (caller should use fallback).
   */
  async start(): Promise<boolean> {
    try {
      const teamId = this.teamId ?? (await this.client.auth.test()).team_id;

      this.chatStreamer = this.client.chatStream({
        channel: this.channel,
        thread_ts: this.threadTs,
        task_display_mode: "plan",
        ...(teamId && { recipient_team_id: teamId }),
        ...(this.userId && { recipient_user_id: this.userId }),
      });

      await this.append([
        {
          type: "task_update",
          id: SlackStreamer.THINKING_TASK_ID,
          title: "Acknowledged, working on it…",
          status: "in_progress",
        },
      ]);

      return true;
    } catch (error) {
      logger.error("Failed to start chat stream:", error);
      this.failed = true;
      return false;
    }
  }

  /**
   * Handle a StreamEvent from askClaude/runClaude.
   * This is the callback to wire into `onEvent`.
   */
  handleEvent = (event: StreamEvent): void => {
    if (this.failed || this.stopped || !this.chatStreamer) return;

    switch (event.type) {
      case "tool_start": {
        const label = getToolLabel(event.toolName, event.toolArgs);
        if (label === null) break;

        this.taskTitles.set(event.taskId, label);

        const chunks: TaskUpdateChunk[] = [];

        // Update the thinking task to "Analyzing…" exactly once,
        // then never touch it again.
        if (!this.thinkingFinalized) {
          this.thinkingFinalized = true;
          chunks.push({
            type: "task_update",
            id: SlackStreamer.THINKING_TASK_ID,
            title: "Analyzing…",
            status: "in_progress",
          });
        }

        chunks.push({
          type: "task_update",
          id: event.taskId,
          title: label,
          status: "in_progress",
        });

        this.append(chunks);
        break;
      }
      case "tool_end": {
        const title = this.taskTitles.get(event.taskId);
        if (!title) break;
        this.taskTitles.delete(event.taskId);

        const task: TaskUpdateChunk = {
          type: "task_update",
          id: event.taskId,
          title: event.error ? `${title} (failed)` : title,
          status: "complete",
        };
        if (event.error && event.errorMessage) {
          task.details = event.errorMessage;
        }

        this.append([task]);
        break;
      }
      case "text": {
        break;
      }
    }
  };

  /**
   * Stop the stream and finalize the message.
   */
  async stop(opts?: {
    markdownText?: string;
    blocks?: (KnownBlock | Block)[];
  }): Promise<void> {
    if (!this.chatStreamer || this.stopped) return;

    this.stopped = true;

    if (!this.failed) {
      await this.append([
        {
          type: "task_update",
          id: SlackStreamer.THINKING_TASK_ID,
          title: this.thinkingFinalized
            ? "Analyzing…"
            : "Acknowledged, working on it…",
          status: "complete",
        },
      ]);
    }

    // If the final append failed (e.g. stream expired due to inactivity),
    // skip the stop call — the stream is already gone.
    if (this.failed) {
      this.chatStreamer = null;
      return;
    }

    try {
      await this.chatStreamer.stop({
        ...(opts?.markdownText && { markdown_text: opts.markdownText }),
        ...(opts?.blocks && { blocks: opts.blocks }),
      });
    } catch (error) {
      logger.error("Failed to stop chat stream:", error);
      this.failed = true;
    }
  }

  /** Whether the stream has failed and the caller should use a fallback. */
  get hasFailed(): boolean {
    return this.failed;
  }

  // --- Private ---

  private async append(chunks: TaskUpdateChunk[]): Promise<void> {
    if (!this.chatStreamer) return;
    try {
      await this.chatStreamer.append({ chunks });
    } catch (error) {
      logger.error("Failed to append to chat stream:", error);
      this.failed = true;
    }
  }
}
