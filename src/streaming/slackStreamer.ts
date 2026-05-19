import type { App } from "@slack/bolt";
import type { Block, KnownBlock, TaskUpdateChunk } from "@slack/types";
import type { ChatStreamer } from "@slack/web-api";
import { logger as defaultLogger } from "../logger.js";
import { getToolLabel, getToolGroup, getToolDetails } from "./toolLabels.js";
import type { StreamEvent } from "./types.js";

export interface SlackStreamerLogger {
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface SlackStreamerOptions {
  client: App["client"];
  channel: string;
  threadTs: string;
  /** User ID of the recipient (required for channel streams). */
  userId?: string;
  /** Team ID (required for channel streams). Avoids an extra auth.test call if provided. */
  teamId?: string;
  /** Custom title for the thinking task once tools start (defaults to "Analyzing…"). */
  thinkingTitle?: string;
  /** Logger instance for dependency injection in tests. */
  logger?: SlackStreamerLogger;
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
  private thinkingTitle: string;
  private logger: SlackStreamerLogger;

  private chatStreamer: ChatStreamer | null = null;
  private thinkingFinalized = false;
  private failed = false;
  private stopped = false;
  private messageTs: string | undefined;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastEventAt = 0;
  private lastKeepaliveTickAt = 0;

  private static readonly KEEPALIVE_INTERVAL_MS = 15_000;
  private static readonly VISIBLE_PROGRESS_THRESHOLD_MS = 30_000;

  private static readonly THINKING_TASK_ID = "__thinking__";

  /** Currently open group: consecutive same-key tools share one Slack task. */
  private openGroup: {
    slackId: string;
    key: string;
    title: string;
    count: number;
    pending: number;
    /** Cap on detail lines for this group; resolved when the group is opened. */
    maxDetails: number;
  } | null = null;
  /** Maps each SDK taskId to the Slack task ID it belongs to. */
  private taskSlack = new Map<string, string>();
  /** Tracks individual task labels for non-grouped tools. */
  private taskLabels = new Map<string, string>();
  /**
   * Tracks every in-progress Slack task for per-task keepalive decoration.
   * Keyed by Slack task ID. `baseTitle` is snapshotted lazily on the first
   * decoration tick so re-emits with real args land before the snapshot.
   */
  private activeTasks = new Map<
    string,
    { startedAt: number; baseTitle: string | undefined; isGroup: boolean; tickCount: number }
  >();

  constructor(opts: SlackStreamerOptions) {
    this.client = opts.client;
    this.channel = opts.channel;
    this.threadTs = opts.threadTs;
    this.userId = opts.userId;
    this.teamId = opts.teamId;
    this.thinkingTitle = opts.thinkingTitle ?? "Analyzing…";
    this.logger = opts.logger ?? defaultLogger;
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

      const now = Date.now();
      this.lastEventAt = now;
      this.lastKeepaliveTickAt = now;
      this.startKeepalive();
      return true;
    } catch (error) {
      this.logger.error("Failed to start chat stream:", error);
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

    this.lastEventAt = Date.now();

    switch (event.type) {
      case "tool_start": {
        const label = getToolLabel(event.toolName, event.toolArgs);
        const hasArgs = Object.keys(event.toolArgs).length > 0;

        // Re-emit with real args — check if the tool should now be hidden
        // (e.g., conditionalHidden rules that depend on arg values like file_path)
        const existingSlackId = this.taskSlack.get(event.taskId);
        if (existingSlackId && hasArgs && label === null) {
          this.taskSlack.delete(event.taskId);
          this.taskLabels.delete(event.taskId);
          // Standalone dropped via conditionalHidden — clean up active-task tracking
          if (this.openGroup?.slackId !== existingSlackId) {
            this.activeTasks.delete(existingSlackId);
          }
          if (this.openGroup?.slackId === existingSlackId) {
            this.openGroup.pending--;
            this.openGroup.count--;
            if (this.openGroup.count === 0) {
              this.openGroup = null;
              this.activeTasks.delete(existingSlackId);
            } else {
              const title = this.groupTitle(
                this.taskLabels.get(existingSlackId) ?? this.openGroup.title,
              );
              this.append([
                {
                  type: "task_update",
                  id: existingSlackId,
                  title,
                  status: this.openGroup.pending === 0 ? "complete" : "in_progress",
                },
              ]);
            }
          }
          break;
        }

        if (label === null) break;

        // Re-emit with real args — update the existing task
        if (existingSlackId && hasArgs) {
          if (existingSlackId === event.taskId) {
            // Standalone tool — update label directly
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
          } else {
            // Grouped tool — update the group's details with real args
            const group = getToolGroup(event.toolName, event.toolArgs);
            if (group && this.openGroup && existingSlackId === this.openGroup.slackId) {
              const chunk: TaskUpdateChunk = {
                type: "task_update",
                id: existingSlackId,
                title: this.groupTitle(label),
                status: "in_progress",
              };
              // Once the group's cap is reached, emit one final "…" overflow marker, then
              // stay silent. The header count keeps climbing via groupTitle().
              if (group.itemDetail) {
                const formatted = this.formatGroupDetail(
                  group.itemDetail,
                  this.openGroup.count > 1,
                );
                if (formatted !== null) chunk.details = formatted;
              }
              const details = getToolDetails(event.toolName, event.toolArgs);
              if (details) chunk.details = (chunk.details ? chunk.details + "\n" : "") + details;
              this.append([chunk]);
            }
          }
          break;
        }
        if (existingSlackId) break;

        const group = getToolGroup(event.toolName, event.toolArgs);
        const groupKey = group?.key ?? event.toolName;
        const chunks: TaskUpdateChunk[] = [];

        if (!this.thinkingFinalized) {
          this.thinkingFinalized = true;
          chunks.push({
            type: "task_update",
            id: SlackStreamer.THINKING_TASK_ID,
            title: this.thinkingTitle,
            status: "in_progress",
          });
        }

        if (group && this.openGroup?.key === groupKey) {
          // Same consecutive group — fold into the open task
          this.openGroup.count++;
          this.openGroup.pending++;
          this.taskSlack.set(event.taskId, this.openGroup.slackId);
          // activeTasks entry for this group already exists; do not reset startedAt

          const chunk: TaskUpdateChunk = {
            type: "task_update",
            id: this.openGroup.slackId,
            title: this.groupTitle(this.openGroup.title),
            status: "in_progress",
          };
          // Only append itemDetail when we have real args (skip generic placeholders).
          // Within the cap → real detail; at cap+1 → "…" overflow marker; beyond → silent.
          if (group.itemDetail && hasArgs) {
            const formatted = this.formatGroupDetail(group.itemDetail, true);
            if (formatted !== null) chunk.details = formatted;
          }
          chunks.push(chunk);
        } else {
          // New task (grouped or standalone)
          this.openGroup = group
            ? {
                slackId: event.taskId,
                key: groupKey,
                title: group.title,
                count: 1,
                pending: 1,
                maxDetails: group.maxDetails,
              }
            : null;
          this.taskSlack.set(event.taskId, event.taskId);
          this.taskLabels.set(event.taskId, label);
          this.activeTasks.set(event.taskId, {
            startedAt: this.lastEventAt,
            baseTitle: undefined,
            isGroup: group !== null,
            tickCount: 0,
          });

          const chunk: TaskUpdateChunk = {
            type: "task_update",
            id: event.taskId,
            title: label,
            status: "in_progress",
          };

          // Attach details: itemDetail for grouped (only with real args; routed through
          // the same cap helper so the overflow rule stays consistent), or rich details
          // for standalone.
          if (group) {
            if (group.itemDetail && hasArgs) {
              const formatted = this.formatGroupDetail(group.itemDetail, false);
              if (formatted !== null) chunk.details = formatted;
            }
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
          const title = this.groupTitle(this.taskLabels.get(slackId) ?? this.openGroup.title);
          this.append([
            { type: "task_update", id: slackId, title, status: done ? "complete" : "in_progress" },
          ]);
          if (done) this.activeTasks.delete(slackId);
          break;
        }

        // Standalone task
        const label = this.taskLabels.get(event.taskId) ?? "Task";
        this.taskLabels.delete(event.taskId);
        this.activeTasks.delete(slackId);
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
  async stop(opts?: { markdownText?: string; blocks?: (KnownBlock | Block)[] }): Promise<void> {
    this.stopKeepalive();

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
          title: this.thinkingFinalized ? this.thinkingTitle : "Acknowledged, working on it…",
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
      if (getSlackErrorCode(error) === "message_not_in_streaming_state") {
        this.logger.warn(
          "Chat stream expired (message_not_in_streaming_state) before stop, falling back to post",
          this.streamDiagnostics(),
        );
      } else {
        this.logger.error("Failed to stop chat stream:", error, this.streamDiagnostics());
      }
      this.failed = true;
    }
  }

  /** Whether the stream has failed and the caller should use a fallback. */
  get hasFailed(): boolean {
    return this.failed;
  }

  /** The Slack message timestamp of the streamed message (available after start()). */
  getMessageTs(): string | undefined {
    return this.messageTs;
  }

  // --- Private ---

  /**
   * Compute the details string for the currently open group at its current count.
   * Returns null to suppress emission entirely.
   *
   *   count <= maxDetails  → the real `itemDetail` (this is a normal in-cap line)
   *   count == maxDetails+1 → `…` (one final overflow marker)
   *   count >  maxDetails+1 → null (silent; header `(N)` already conveys the size)
   *   maxDetails == 0      → null (caller chose header-only mode)
   *
   * `prefixNewline` controls whether the result starts with `\n`. The fold and re-emit
   * sites prepend a newline so Slack treats each detail as a new line; the first-item
   * path on a fresh task does not.
   */
  private formatGroupDetail(itemDetail: string, prefixNewline: boolean): string | null {
    if (!this.openGroup) return null;
    const { count, maxDetails } = this.openGroup;
    if (maxDetails === 0) return null;
    const prefix = prefixNewline ? "\n" : "";
    if (count <= maxDetails) return `${prefix}${itemDetail}`;
    if (count === maxDetails + 1) return `${prefix}…`;
    return null;
  }

  private groupTitle(fallback: string): string {
    if (!this.openGroup) return fallback;
    return this.openGroup.count > 1
      ? `${this.openGroup.title} (${this.openGroup.count})`
      : fallback;
  }

  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      if (this.failed || this.stopped) {
        this.stopKeepalive();
        return;
      }
      this.lastKeepaliveTickAt = Date.now();

      // No active tasks → fall back to pinging the thinking task so
      // pre-first-tool dead zones (worktree setup, SDK init) stay alive.
      if (this.activeTasks.size === 0) {
        this.append([
          {
            type: "task_update",
            id: SlackStreamer.THINKING_TASK_ID,
            title: this.thinkingFinalized ? this.thinkingTitle : "Acknowledged, working on it…",
            status: "in_progress",
          },
        ]);
        return;
      }

      // Decorate every in-progress task that has been running long enough.
      const now = this.lastKeepaliveTickAt;
      const chunks: TaskUpdateChunk[] = [];
      for (const [slackId, entry] of this.activeTasks) {
        const elapsed = now - entry.startedAt;
        if (elapsed < SlackStreamer.VISIBLE_PROGRESS_THRESHOLD_MS) continue;

        const base = this.currentBaseTitle(slackId, entry);
        if (!base) continue;
        entry.baseTitle = base;

        chunks.push({
          type: "task_update",
          id: slackId,
          title: `${base} ⏱ ${fmtElapsed(elapsed)}`,
          status: "in_progress",
          details: entry.tickCount === 0 ? "\n ." : " .",
        });
        entry.tickCount++;
      }

      if (chunks.length > 0) this.append(chunks);
    }, SlackStreamer.KEEPALIVE_INTERVAL_MS);
    this.keepaliveTimer.unref();
  }

  /**
   * Resolve the "base" title to decorate at tick time.
   * Groups re-derive on every tick so the `(N)` count stays current.
   * Standalones read from `taskLabels` (snapshotted lazily via `entry.baseTitle`).
   */
  private currentBaseTitle(
    slackId: string,
    entry: { isGroup: boolean; baseTitle: string | undefined },
  ): string | undefined {
    if (entry.isGroup && this.openGroup?.slackId === slackId) {
      return this.openGroup.count > 1
        ? `${this.openGroup.title} (${this.openGroup.count})`
        : (this.taskLabels.get(slackId) ?? this.openGroup.title);
    }
    if (entry.baseTitle) return entry.baseTitle;
    return this.taskLabels.get(slackId);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private async append(chunks: TaskUpdateChunk[]): Promise<void> {
    if (!this.chatStreamer || this.failed) return;
    try {
      const result = await this.chatStreamer.append({ chunks });
      if (!this.messageTs && result?.ts) {
        this.messageTs = result.ts;
      }
    } catch (error) {
      // If stop() was already called, this is a benign race — an in-flight
      // append from handleEvent resolved after the stream was finalized.
      if (this.stopped) return;

      // Slack expires streams server-side after inactivity, OR garbage-collects the
      // placeholder message in the assistant API when a new userMessage event arrives.
      // Both surface as known terminal conditions for the stream — log as warning, not
      // error, and let the fallback path handle them.
      const code = getSlackErrorCode(error);
      if (code === "message_not_in_streaming_state" || code === "message_not_found") {
        this.logger.warn(
          `Chat stream no longer writable (${code}), falling back to post`,
          this.streamDiagnostics(),
        );
      } else {
        this.logger.error("Failed to append to chat stream:", error, this.streamDiagnostics());
      }

      this.failed = true;
      this.stopKeepalive();
    }
  }

  private streamDiagnostics(): {
    msSinceLastTick: number;
    msSinceLastEvent: number;
    activeTaskCount: number;
  } {
    const now = Date.now();
    return {
      msSinceLastTick: this.lastKeepaliveTickAt === 0 ? -1 : now - this.lastKeepaliveTickAt,
      msSinceLastEvent: this.lastEventAt === 0 ? -1 : now - this.lastEventAt,
      activeTaskCount: this.activeTasks.size,
    };
  }
}

function getSlackErrorCode<E>(error: E): string | undefined {
  if (typeof error !== "object" || error === null || !("data" in error)) return undefined;
  return (error as { data?: { error?: string } }).data?.error;
}

/**
 * Format a duration for keepalive decoration.
 * - `< 60s`: `"45s"`
 * - `60s`–`599s`: `"1m 5s"`
 * - `>= 600s`: `"15m"` (seconds dropped once minutes ≥ 10)
 */
export function fmtElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 10) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
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
  result: {
    success: boolean;
    error?: string;
    cancelled?: boolean;
    cancelledBy?: { userId: string; reason?: string };
    prUrl?: string;
  },
  label: string,
): Promise<void> {
  if (result.success) {
    await streamer.stop();
    // If the streamer died mid-run, the frozen in-progress task is all the
    // user sees. Post a plain thread reply so they still get a final-state
    // confirmation (the PR URL if available).
    if (streamer.hasFailed) {
      const message = result.prUrl ? `${label} complete: ${result.prUrl}` : `${label} complete.`;
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: message });
    }
  } else if (result.cancelled && result.cancelledBy) {
    const reason = result.cancelledBy.reason ? `: ${result.cancelledBy.reason}` : "";
    const message = `This work session was cancelled by <@${result.cancelledBy.userId}>${reason}`;
    if (streamer.hasFailed) {
      await streamer.stop();
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: message });
    } else {
      await streamer.stop({ markdownText: message });
    }
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
