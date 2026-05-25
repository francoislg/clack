## Why

When `SlackStreamer`'s underlying `chatStream` dies mid-run (Slack server-side expiry, or the assistant API GCs the placeholder), the in-thread task card freezes silently and the user sees no further progress until the final `chat.postMessage` fallback fires at completion. For long-running queries and worker flows this can be a 30–90s blackout of live progress, defeating the purpose of streaming.

Slack's `chat.appendStream` exposes three terminal error codes: `message_not_in_streaming_state`, `message_not_found`, and `stopped_by_user`. The first two are recoverable — we can open a fresh stream in the same thread and keep posting task cards. The third is a deliberate user action and must be respected.

## What Changes

- `SlackStreamer.append()` detects recoverable stream failures (`message_not_in_streaming_state`, `message_not_found`) and automatically opens a new `chatStream` in the same channel/thread to continue posting task cards.
- The fresh block is a clean continuation — no state is carried over from the dead block. The new block's persistent thinking task starts with "Continuing previous stream…" (instead of "Acknowledged, working on it…") so the user understands why a new card appears.
- The previously failing `append()` call's chunks are replayed once against the new stream.
- A rollover cap (`MAX_ROLLOVERS = 2`) caps a single workflow at 3 stream blocks; beyond that, the streamer enters the existing failed state and the caller falls back to `chat.postMessage` as today.
- `stopped_by_user` is recognized as a non-recoverable, deliberate halt: no rollover, and it is logged as `warn` (not `error` — a pre-existing log-noise issue resolved as part of this change).
- New public API: `getAllMessageTss(): string[]` returns the timestamps of every block the streamer has opened (used by callers that need to delete the streamer's footprint — skip, cancel, top-level repost). `getMessageTs()` continues to return the *latest* block's ts, which is where reactions and session bookkeeping should land.
- Three call sites in `handlerResponse.ts` (skip, cancel, top-level repost) are updated to iterate `getAllMessageTss()` so every rolled-over block is deleted, not just the first.
- A `rolloverCount` log on stream completion (and a `rollover_count` field in `streamDiagnostics()`) surfaces flapping streams to operators.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `streaming-responses`: stream lifecycle adds reactive rollover semantics; new requirement covers continuation behavior, the per-block ts list, and the `stopped_by_user` opt-out.

## Impact

- **Code touched:**
  - `src/streaming/slackStreamer.ts` — rollover logic in `append()` catch, new `messageTss[]` and `rolloverCount` fields, `getAllMessageTss()` accessor, `stopped_by_user` classification.
  - `src/slack/handlers/handlerResponse.ts` — three delete call sites switch to `getAllMessageTss()` and iterate.
  - `src/streaming/slackStreamer.test.ts` — new test cases for rollover happy path, cap, `stopped_by_user` opt-out, and post-rollover `tool_end` no-op behavior.
- **APIs:** no Slack API behavior changes; uses existing `chatStream` to open additional streams in the same thread. Adds one new public method on `SlackStreamer`.
- **Configuration:** none. Rollover cap is a hardcoded constant; can be revisited if production data warrants tuning.
- **Migration:** none. New behavior is purely additive — workflows that never trigger a recoverable failure are unaffected.
