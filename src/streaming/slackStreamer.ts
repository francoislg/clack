import type { App } from "@slack/bolt";
import type { Block, KnownBlock, TaskUpdateChunk } from "@slack/types";
import type { ChatStreamer } from "@slack/web-api";
import { logger } from "../logger.js";
import { getToolLabel, getToolGroup, getToolDetails } from "./toolLabels.js";
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
  private thinkingFinalized = false;
  private failed = false;
  private stopped = false;

  private static readonly THINKING_TASK_ID = "__thinking__";

  /** Currently open group: consecutive same-key tools share one Slack task. */
  private openGroup: { slackId: string; key: string; title: string; count: number; pending: number } | null = null;
  /** Maps each SDK taskId to the Slack task ID it belongs to. */
  private taskSlack = new Map<string, string>();
  /** Tracks individual task labels for non-grouped tools. */
  private taskLabels = new Map<string, string>();

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
        const hasArgs = Object.keys(event.toolArgs).length > 0;

        // Re-emit with real args — update the existing task
        const existingSlackId = this.taskSlack.get(event.taskId);
        if (existingSlackId) {
          // Re-emit for standalone tool — update label with real args
          if (hasArgs && existingSlackId === event.taskId) {
            this.taskLabels.set(event.taskId, label);
            const chunk: TaskUpdateChunk = {
              type: "task_update",
              id: existingSlackId,
              title: label,
              status: "in_progress",
            };
            const details = getToolDetails(event.toolName, event.toolArgs);
            if (details) chunk.details = details;
            this.append([chunk]);
          }
          break;
        }

        const group = getToolGroup(event.toolName, event.toolArgs);
        const groupKey = group?.key ?? event.toolName;
        const chunks: TaskUpdateChunk[] = [];

        if (!this.thinkingFinalized) {
          this.thinkingFinalized = true;
          chunks.push({
            type: "task_update",
            id: SlackStreamer.THINKING_TASK_ID,
            title: "Analyzing…",
            status: "in_progress",
          });
        }

        if (group && this.openGroup?.key === groupKey) {
          // Same consecutive group — fold into the open task
          this.openGroup.count++;
          this.openGroup.pending++;
          this.taskSlack.set(event.taskId, this.openGroup.slackId);

          const chunk: TaskUpdateChunk = {
            type: "task_update",
            id: this.openGroup.slackId,
            title: `${this.openGroup.title} (${this.openGroup.count})`,
            status: "in_progress",
          };
          // Only append itemDetail when we have real args (skip generic placeholders)
          if (group.itemDetail && hasArgs) chunk.details = `\n${group.itemDetail}`;
          chunks.push(chunk);
        } else {
          // New task (grouped or standalone)
          this.openGroup = group
            ? { slackId: event.taskId, key: groupKey, title: group.title, count: 1, pending: 1 }
            : null;
          this.taskSlack.set(event.taskId, event.taskId);
          this.taskLabels.set(event.taskId, label);

          const chunk: TaskUpdateChunk = {
            type: "task_update",
            id: event.taskId,
            title: label,
            status: "in_progress",
          };

          // Attach details: itemDetail for grouped (only with real args), or rich details for standalone
          if (group) {
            if (group.itemDetail && hasArgs) chunk.details = group.itemDetail;
          } else {
            const details = getToolDetails(event.toolName, event.toolArgs);
            if (details) chunk.details = details;
          }
          chunks.push(chunk);
        }

        this.append(chunks);
        break;
      }
      case "tool_end": {
        const slackId = this.taskSlack.get(event.taskId);
        if (!slackId) break;
        this.taskSlack.delete(event.taskId);

        // Grouped task — decrement pending, only complete when all done
        if (this.openGroup?.slackId === slackId) {
          this.openGroup.pending--;
          const done = this.openGroup.pending === 0;
          const title = this.openGroup.count > 1
            ? `${this.openGroup.title} (${this.openGroup.count})`
            : this.openGroup.title;
          this.append([{ type: "task_update", id: slackId, title, status: done ? "complete" : "in_progress" }]);
          break;
        }

        // Standalone task
        const label = this.taskLabels.get(event.taskId) ?? "Task";
        this.taskLabels.delete(event.taskId);
        const task: TaskUpdateChunk = {
          type: "task_update",
          id: slackId,
          title: event.error ? `${label} (failed)` : label,
          status: "complete",
        };
        if (event.error && event.errorMessage) task.details = event.errorMessage;
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

    // Force-complete standalone tasks still in-flight (tool_end hasn't arrived yet)
    const openGroupSlackId = this.openGroup?.slackId;
    for (const [taskId, slackId] of this.taskSlack) {
      if (slackId === openGroupSlackId) continue; // handled by the open-group block below
      const label = this.taskLabels.get(taskId) ?? "Task";
      await this.append([{ type: "task_update", id: slackId, title: label, status: "complete" }]);
    }

    // Force-complete the open group if it still has pending items (e.g. cancellation)
    if (this.openGroup && this.openGroup.pending > 0) {
      const g = this.openGroup;
      const title = g.count > 1 ? `${g.title} (${g.count})` : g.title;
      await this.append([{ type: "task_update", id: g.slackId, title, status: "complete" }]);
    }

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

/**
 * Finalize a streamed workflow by stopping the streamer and posting a result message.
 * Handles success, failure (with streamer-failed fallback), and unexpected errors.
 */
export async function finalizeStreamedWorkflow(
  streamer: SlackStreamer,
  client: App["client"],
  channel: string,
  threadTs: string,
  result: { success: boolean; error?: string },
  label: string,
): Promise<void> {
  if (result.success) {
    await streamer.stop();
  } else {
    const message = `${label} failed: ${result.error}`;
    if (streamer.hasFailed) {
      await streamer.stop();
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: message });
    } else {
      await streamer.stop({ markdownText: message });
    }
  }
}
