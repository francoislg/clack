## Why

The Slack chat-stream keep-alive shipped in `2026-04-07-stream-keepalive` is not preventing stream expiry in worker mode. On 2026-04-20 a worker run died visually in Slack at "Run TypeScript typecheck to verify all fixes" while the worker itself kept executing to completion. The current keep-alive only rotates dots on the `THINKING_TASK_ID` title; evidence suggests Slack is not counting these near-identical updates as activity.

We also have no production visibility into *when* the keep-alive fires or *how long* streams live before dying, so every fix has been speculative.

## What Changes

- **Track all in-progress tasks**, not just the thinking header. Each task tracked individually with its `startedAt` time, `baseTitle`, and tick count.
- **Replace the rotating-dots keep-alive** with per-task updates that (a) update each in-progress task's `title` with a `:stopwatch: {elapsed}` suffix (title replaces), AND (b) append a single dot to each in-progress task's `details` (details appends). Both changes land in one `chat.appendStream` call per tick.
- **Only decorate tasks after a 30s visible-progress threshold** — avoids clutter on fast tools.
- **Enrich the existing stream-failure warn log** at `src/streaming/slackStreamer.ts:410-411` with `msSinceLastTick`, `msSinceLastEvent`, and `activeTaskCount` fields. Warn-level only (Docker suppresses debug).
- **Preserve the existing 15s tick interval** and existing fallback behavior on failure.

Non-goals:
- Stream recovery (detecting `message_not_in_streaming_state` and restarting on the same thread) is out of scope for this change. If instrumentation reveals this is still needed, propose it separately.
- Changes to the query-mode path beyond what's necessary to share the new per-task tracking.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `streaming-responses`: keep-alive targets all in-progress tasks with both title and details updates, not just the thinking header. Adds diagnostic fields to stream-failure logs.

## Impact

- **Code:** `src/streaming/slackStreamer.ts` (keep-alive loop, event handlers to track `activeTasks` map, failure log)
- **Tests:** `src/streaming/slackStreamer.test.ts` (existing keep-alive tests need updating; add tests for per-task timer, threshold, dot append, group interactions, and failure-log fields)
- **No API/dependency changes.** Uses existing Slack `task_update` chunk semantics (title=replace, details=append).
- **User-visible:** tasks that run ≥30s will show `:stopwatch: 45s` in their title and a growing dot trail in their details. Fast tasks are unchanged.
