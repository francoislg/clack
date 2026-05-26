import type { App } from "@slack/bolt";
import type { Block, KnownBlock, TaskUpdateChunk } from "@slack/types";
import type { ChatStreamer } from "@slack/web-api";
import { logger as defaultLogger } from "../logger.js";
import { getToolLabel, getToolGroup, getToolDetails } from "./toolLabels.js";
import type { StreamEvent } from "./types.js";
import { unfurlOptions } from "../slack/unfurlOptions.js";
import { t } from "../i18n/t.js";

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
  /** Timestamps of every prior block opened by this streamer (oldest first). The
   *  current block's ts lives in `messageTs` until rollover, at which point it is
   *  pushed here and `messageTs` resets for the new block to capture. */
  private priorMessageTss: string[] = [];
  private reactiveRolloverCount = 0;
  private preemptiveRolloverCount = 0;
  /** Serializes concurrent rollover paths (preemptive timer firing while a reactive append
   *  failure is also triggering rollover in the same tick). */
  private rolloverInFlight = false;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private preemptiveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEventAt = 0;
  private lastKeepaliveTickAt = 0;

  private static readonly KEEPALIVE_INTERVAL_MS = 15_000;
  private static readonly VISIBLE_PROGRESS_THRESHOLD_MS = 30_000;
  private static readonly MAX_REACTIVE_ROLLOVERS = 2;
  /** At PREEMPTIVE_ROLLOVER_INTERVAL_MS = 4min, 20 rotations covers ~80 minutes of work. */
  private static readonly MAX_PREEMPTIVE_ROLLOVERS = 20;
  /** Sized under Slack's empirically-observed ~5-minute chatStream TTL. */
  private static readonly PREEMPTIVE_ROLLOVER_INTERVAL_MS = 4 * 60 * 1000;

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
    /**
     * Detail line for the FIRST item, deferred while count === 1. Single-item groups
     * already convey the same info in their title, so we only flush this when count
     * grows to 2+ (where the first item's contribution is no longer redundant with the
     * group header).
     */
    pendingFirstDetail?: string;
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
      this.chatStreamer = await this.openChatStream();

      await this.append([
        {
          type: "task_update",
          id: SlackStreamer.THINKING_TASK_ID,
          title: t("streamer.acknowledged"),
          status: "in_progress",
        },
      ]);

      const now = Date.now();
      this.lastEventAt = now;
      this.lastKeepaliveTickAt = now;
      this.startKeepalive();
      this.schedulePreemptiveRollover();
      return true;
    } catch (error) {
      this.logger.error("Failed to start chat stream:", error);
      this.failed = true;
      return false;
    }
  }

  /** Build the chat stream handle. Used by both `start()` and `rollover()` so they stay in sync. */
  private async openChatStream(): Promise<ChatStreamer> {
    const teamId = this.teamId ?? (await this.client.auth.test()).team_id;
    return this.client.chatStream({
      channel: this.channel,
      thread_ts: this.threadTs,
      task_display_mode: "plan",
      ...(teamId && { recipient_team_id: teamId }),
      ...(this.userId && { recipient_user_id: this.userId }),
    });
  }

  /**
   * Rotate to a fresh chat stream. Triggered reactively on a recoverable append failure
   * (Slack TTL expiry, assistant API GC) or preemptively on a timer before Slack's ~5min
   * TTL would expire the current stream. Returns false if another rollover is already in
   * flight, or if the new stream fails to open.
   */
  private async rollover(opts: { preemptive?: boolean } = {}): Promise<boolean> {
    const preemptive = opts.preemptive === true;
    if (this.rolloverInFlight) return false;
    this.rolloverInFlight = true;
    try {
      // Snapshot + mark-complete must run BEFORE this.chatStreamer is reassigned below.
      const snapshot = this.snapshotInFlightTasks();
      await this.markPriorBlockInFlightComplete(snapshot);

      if (this.messageTs) this.priorMessageTss.push(this.messageTs);
      this.messageTs = undefined;
      this.openGroup = null;
      this.taskSlack.clear();
      this.taskLabels.clear();
      this.activeTasks.clear();
      if (!preemptive) this.thinkingFinalized = false;
      this.failed = false;
      if (preemptive) this.preemptiveRolloverCount++;
      else this.reactiveRolloverCount++;

      this.chatStreamer = await this.openChatStream();

      const continuationTitle = preemptive
        ? this.thinkingFinalized
          ? this.thinkingTitle
          : t("streamer.acknowledged")
        : t("streamer.continuing");

      // Direct chatStreamer.append rather than `this.append()` so that a failure here throws
      // synchronously and is caught by this method (rather than recursively re-entering
      // append's catch and triggering another rollover attempt).
      const result = await this.chatStreamer.append({
        chunks: [
          {
            type: "task_update",
            id: SlackStreamer.THINKING_TASK_ID,
            title: continuationTitle,
            status: "in_progress",
          },
        ],
      });
      if (result?.ts) this.messageTs = result.ts;

      const now = Date.now();
      this.lastEventAt = now;
      this.lastKeepaliveTickAt = now;

      await this.reEmitInFlightTasksOnNewBlock(snapshot, now);
      this.schedulePreemptiveRollover();
      return true;
    } catch (error) {
      this.logger.warn("Rollover failed:", error, this.streamDiagnostics());
      return false;
    } finally {
      this.rolloverInFlight = false;
    }
  }

  private snapshotInFlightTasks(): Array<{
    sdkTaskId: string;
    slackId: string;
    label: string;
  }> {
    const out: Array<{ sdkTaskId: string; slackId: string; label: string }> = [];
    for (const [sdkTaskId, slackId] of this.taskSlack) {
      const label =
        this.taskLabels.get(sdkTaskId) ?? this.taskLabels.get(slackId) ?? this.openGroup?.title;
      if (!label) continue;
      out.push({ sdkTaskId, slackId, label });
    }
    return out;
  }

  /** Best-effort: the block is about to be abandoned, so an append failure here is
   *  swallowed rather than failing the rollover. */
  private async markPriorBlockInFlightComplete(
    snapshot: Array<{ slackId: string; label: string }>,
  ): Promise<void> {
    if (!this.chatStreamer || snapshot.length === 0) return;
    const chunks: TaskUpdateChunk[] = snapshot.map((s) => ({
      type: "task_update",
      id: s.slackId,
      title: s.label,
      status: "complete",
    }));
    try {
      await this.chatStreamer.append({ chunks });
    } catch {
      // Prior stream may already be dead; that's the whole reason we're rolling over.
    }
  }

  /** Re-emits each in-flight task on the new block as a fresh standalone card (group folding
   *  does NOT cross the rollover boundary) and fires an immediate elapsed-time decoration
   *  so the new block isn't blank until the next keepalive tick. */
  private async reEmitInFlightTasksOnNewBlock(
    snapshot: Array<{ sdkTaskId: string; slackId: string; label: string }>,
    startedAt: number,
  ): Promise<void> {
    if (!this.chatStreamer || snapshot.length === 0) return;
    const chunks: TaskUpdateChunk[] = [];
    for (const s of snapshot) {
      // Reuse SDK taskId so the eventual tool_end still maps; reuse slackId so the
      // re-emitted card has the same identity as the prior block's complete'd card.
      this.taskSlack.set(s.sdkTaskId, s.slackId);
      this.taskLabels.set(s.sdkTaskId, s.label);
      this.activeTasks.set(s.slackId, {
        startedAt,
        baseTitle: s.label,
        isGroup: false,
        tickCount: 0,
      });
      chunks.push({
        type: "task_update",
        id: s.slackId,
        title: s.label,
        status: "in_progress",
      });
      chunks.push({
        type: "task_update",
        id: s.slackId,
        title: `${s.label} ⏱ ${fmtElapsed(0)}`,
        status: "in_progress",
        details: "\n .",
      });
    }
    try {
      await this.chatStreamer.append({ chunks });
    } catch {
      // Rollover itself succeeded (continuation cue landed); the regular append path will
      // retry on the next handleEvent or keepalive tick.
    }
  }

  private schedulePreemptiveRollover(): void {
    this.clearPreemptiveTimer();
    if (this.preemptiveRolloverCount >= SlackStreamer.MAX_PREEMPTIVE_ROLLOVERS) {
      this.logger.warn(
        "Preemptive rollover cap reached; no further preemptive rotations will be scheduled",
        this.streamDiagnostics(),
      );
      return;
    }
    this.preemptiveTimer = setTimeout(() => {
      if (this.failed || this.stopped) return;
      this.rollover({ preemptive: true }).catch((err) => {
        this.logger.warn("Preemptive rollover threw:", err, this.streamDiagnostics());
      });
    }, SlackStreamer.PREEMPTIVE_ROLLOVER_INTERVAL_MS);
    this.preemptiveTimer.unref?.();
  }

  private clearPreemptiveTimer(): void {
    if (this.preemptiveTimer) {
      clearTimeout(this.preemptiveTimer);
      this.preemptiveTimer = null;
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
            // Standalone tool, OR first item of a group (count=1) — update label.
            // For the group case we ALSO defer the now-resolvable itemDetail into
            // pendingFirstDetail so it can flush if a second item folds in later.
            this.taskLabels.set(event.taskId, label);
            const chunk: TaskUpdateChunk = {
              type: "task_update",
              id: existingSlackId,
              title: label,
              status: "in_progress",
            };
            const details = getToolDetails(event.toolName, event.toolArgs);
            if (details) chunk.details = details;
            if (
              this.openGroup &&
              this.openGroup.slackId === existingSlackId &&
              this.openGroup.count === 1 &&
              this.openGroup.pendingFirstDetail === undefined
            ) {
              const group = getToolGroup(event.toolName, event.toolArgs);
              if (group?.itemDetail) {
                const formatted = this.formatGroupDetail(group.itemDetail, false);
                if (formatted !== null) this.openGroup.pendingFirstDetail = formatted;
              }
            }
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
          // Flush the deferred first-item detail when count grows past 1. From count=3
          // onward, pendingFirstDetail is already cleared and we fall back to normal
          // per-item appending.
          const pending = this.openGroup.pendingFirstDetail;
          this.openGroup.pendingFirstDetail = undefined;
          // Only append itemDetail when we have real args (skip generic placeholders).
          // Within the cap → real detail; at cap+1 → "…" overflow marker; beyond → silent.
          let thisDetail: string | null = null;
          if (group.itemDetail && hasArgs) {
            thisDetail = this.formatGroupDetail(group.itemDetail, true);
          }
          // Combine the pending first-item detail (stored without a leading newline)
          // with this item's detail (which starts with "\n" because prefixNewline=true).
          // Result: "pending\nthisDetail" — no leading newline because the task had no
          // prior details.
          if (pending !== undefined && thisDetail !== null) chunk.details = pending + thisDetail;
          else if (pending !== undefined) chunk.details = pending;
          else if (thisDetail !== null) chunk.details = thisDetail;
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

          // Attach details: for grouped, defer the first item's detail until count > 1
          // (a single-item group's title already conveys the same info as the detail line).
          // For standalone, emit rich details immediately.
          if (group) {
            if (group.itemDetail && hasArgs && this.openGroup) {
              const formatted = this.formatGroupDetail(group.itemDetail, false);
              if (formatted !== null) this.openGroup.pendingFirstDetail = formatted;
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
    this.clearPreemptiveTimer();

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
          title: this.thinkingFinalized ? this.thinkingTitle : t("streamer.acknowledged"),
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

  /** The Slack message timestamp of the streamed message (available after start()).
   *  After rollover, this returns the LATEST block's ts (where the final answer is rendered). */
  getMessageTs(): string | undefined {
    return this.messageTs;
  }

  /** All Slack message timestamps this streamer has opened, oldest first. The current
   *  block's ts (if any) is always last. Returns one ts in the no-rollover case, N+1 tss
   *  after N successful rollovers. Callers that need to delete the streamer's full footprint
   *  (skip, cancel, top-level repost) iterate this list. */
  getAllMessageTss(): string[] {
    return this.messageTs ? [...this.priorMessageTss, this.messageTs] : [...this.priorMessageTss];
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
            title: this.thinkingFinalized ? this.thinkingTitle : t("streamer.acknowledged"),
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

      const code = getSlackErrorCode(error);

      // The user clicked the stop control in the streaming UI. Deliberate halt;
      // no rollover, no further activity. Log as warn (not error) since it's
      // an expected outcome of a user-driven feature.
      if (code === "stopped_by_user") {
        this.logger.warn("Chat stream stopped by user", this.streamDiagnostics());
        this.failed = true;
        this.stopKeepalive();
        this.clearPreemptiveTimer();
        return;
      }

      // Slack expires streams after inactivity OR GCs the assistant API placeholder when a
      // new userMessage arrives. Both are recoverable via rollover; cap prevents flapping.
      const recoverable = code === "message_not_in_streaming_state" || code === "message_not_found";
      if (recoverable && this.reactiveRolloverCount < SlackStreamer.MAX_REACTIVE_ROLLOVERS) {
        const ok = await this.rollover();
        if (ok && this.chatStreamer) {
          // The rollover already posted its own continuation chunk for THINKING_TASK_ID;
          // replaying e.g. a stale "Acknowledged" idle ping would clobber that title.
          const replayChunks = chunks.filter((c) => c.id !== SlackStreamer.THINKING_TASK_ID);
          if (replayChunks.length === 0) return;
          try {
            const result = await this.chatStreamer.append({ chunks: replayChunks });
            if (!this.messageTs && result?.ts) {
              this.messageTs = result.ts;
            }
            return;
          } catch {
            // Retry on the new stream also failed — fall through to the failure-logging path.
          }
        }
      }

      if (recoverable) {
        this.logger.warn(
          `Chat stream no longer writable (${code}), falling back to post`,
          this.streamDiagnostics(),
        );
      } else {
        this.logger.error("Failed to append to chat stream:", error, this.streamDiagnostics());
      }

      this.failed = true;
      this.stopKeepalive();
      this.clearPreemptiveTimer();
    }
  }

  private streamDiagnostics(): {
    msSinceLastTick: number;
    msSinceLastEvent: number;
    activeTaskCount: number;
    reactiveRolloverCount: number;
    preemptiveRolloverCount: number;
  } {
    const now = Date.now();
    return {
      msSinceLastTick: this.lastKeepaliveTickAt === 0 ? -1 : now - this.lastKeepaliveTickAt,
      msSinceLastEvent: this.lastEventAt === 0 ? -1 : now - this.lastEventAt,
      activeTaskCount: this.activeTasks.size,
      reactiveRolloverCount: this.reactiveRolloverCount,
      preemptiveRolloverCount: this.preemptiveRolloverCount,
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
  options: { suppressUnfurls?: boolean } = {},
): Promise<void> {
  const unfurl = unfurlOptions(options.suppressUnfurls);
  if (result.success) {
    await streamer.stop();
    // If the streamer died mid-run, the frozen in-progress task is all the
    // user sees. Post a plain thread reply so they still get a final-state
    // confirmation (the PR URL if available).
    if (streamer.hasFailed) {
      const message = result.prUrl ? `${label} complete: ${result.prUrl}` : `${label} complete.`;
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: message, ...unfurl });
    }
  } else if (result.cancelled && result.cancelledBy) {
    const reason = result.cancelledBy.reason ? `: ${result.cancelledBy.reason}` : "";
    const message = `This work session was cancelled by <@${result.cancelledBy.userId}>${reason}`;
    if (streamer.hasFailed) {
      await streamer.stop();
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: message, ...unfurl });
    } else {
      await streamer.stop({ markdownText: message });
    }
  } else {
    const message = `${label} failed: ${result.error}`;
    if (streamer.hasFailed) {
      await streamer.stop();
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: message, ...unfurl });
    } else {
      await streamer.stop({ markdownText: message });
    }
  }
}
