## Context

`SlackStreamer` wraps Slack's `ChatStreamer` API (`chat.startStream` / `chat.appendStream` / `chat.stopStream`). Slack expires streams server-side after a period of inactivity. During change workflows, the gap between `streamer.start()` and the first tool event can span 30-60+ seconds (git fetch, worktree creation, SDK startup, Claude thinking), causing `appendStream` to fail with `message_not_in_streaming_state`.

The fallback path already works (response delivered via `chat.postMessage`), but produces noisy error logs and leaves an orphaned streaming message in Slack.

## Goals / Non-Goals

**Goals:**
- Prevent stream expiry by sending periodic keepalive appends during idle periods
- Reduce log noise by classifying `message_not_in_streaming_state` as a warning
- Keep the fix contained to `SlackStreamer` — no changes to workflows, event types, or callers

**Non-Goals:**
- Adding phase-aware status events (e.g., "Creating workspace...") — that's UX polish for a follow-up
- Cleaning up orphaned streaming messages on failure
- Changing the stream start timing relative to workflow phases

## Decisions

### Keepalive mechanism: interval timer re-sending the thinking task

The timer calls `this.append()` with the current thinking task state every ~15 seconds. Since `append()` triggers `chat.appendStream`, Slack counts it as activity regardless of whether the content changed.

**Alternatives considered:**
- **New `StreamEvent` type for phase updates**: More informative UX, but requires changes across `StreamEvent`, `SlackStreamer.handleEvent`, and all workflow callsites. Doesn't cover arbitrary dead zones (e.g., Claude thinking for 60s mid-execution). Could be layered on top later.
- **Deferring stream start to after `createWorktree`**: Eliminates the biggest dead zone but requires restructuring `triggerChangeWorkflow` / `startChangeWorkflow` and doesn't solve zone 2 (between setup and execution) or mid-execution pauses.

### Timer lifecycle: start on `start()`, clear on `stop()` and failure

The timer is started after the initial append succeeds in `start()`. It's cleared:
- In `stop()` (normal completion)
- When `this.failed` is set to `true` (stream failure detected)
- If `start()` itself fails

This prevents timer leaks in all code paths.

### Keepalive content: re-send current thinking task state

The keepalive re-sends:
```typescript
{ type: "task_update", id: THINKING_TASK_ID, title: <current title>, status: "in_progress" }
```

This is the same task the user already sees. No visual change, just an API call to reset Slack's inactivity timer.

### Error classification: detect `message_not_in_streaming_state` specifically

In the `append()` catch block, check for `error.data?.error === 'message_not_in_streaming_state'` and log as `warn` instead of `error`. The keepalive reduces occurrences but race conditions (e.g., keepalive in-flight when Slack expires at the exact threshold) mean it can still happen occasionally.

## Risks / Trade-offs

- **Increased API volume**: ~4 extra `appendStream` calls per minute of inactivity. Negligible compared to overall Slack API usage. → Acceptable trade-off for stream reliability.
- **Keepalive races with real events**: Both `handleEvent` and the keepalive call `this.append()` concurrently. Since `append` is async and JavaScript is single-threaded, the calls queue correctly. Two concurrent `chat.appendStream` HTTP calls are safe — Slack handles them independently. → No mitigation needed.
- **Slack rejects identical updates**: If Slack's API rejects no-op task updates, the keepalive would cause stream failure. → Very unlikely given the API is designed for incremental streaming. If it happens, the existing fallback path handles it gracefully.
