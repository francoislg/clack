## Why

Slack chat streams expire server-side after a period of inactivity. During long-running change workflows, dead zones with no `appendStream` calls (git fetch/worktree creation, SDK startup, Claude thinking) cause the stream to expire. The next append fails with `message_not_in_streaming_state`, leaving an orphaned progress card and triggering noisy error logs. The fallback to `chat.postMessage` works, but the UX is degraded.

## What Changes

- Add a periodic keepalive timer inside `SlackStreamer` that re-sends the current thinking task update at a fixed interval (e.g., every 15 seconds) to prevent Slack from expiring the stream
- Downgrade the `message_not_in_streaming_state` error log to a warning, since it's a known/expected condition when streams expire (keepalive reduces but may not fully eliminate this)
- Timer is automatically started on `start()` and cleared on `stop()`, `failed` state, or start failure

## Capabilities

### New Capabilities

_None_

### Modified Capabilities

- `streaming-responses`: Adding a keepalive mechanism to the stream lifecycle to prevent server-side expiry during idle periods

## Impact

- `src/streaming/slackStreamer.ts` — add keepalive timer logic, improve error classification
- No API changes, no new dependencies
- Slightly increases Slack API call volume (one extra `appendStream` per ~15s of inactivity)
