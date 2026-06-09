## Why

The streamer rolls a healthy, actively-streaming card to a fresh one **every 4 minutes** (preemptive rollover), to stay ahead of Slack's ~5-minute chatStream TTL. That blind timer collides with the in-flight keepalive append on the old stream: after a preemptive (or reactive) rollover advances the stream, a stale append bound to the *old* generation rejects and — guarded only by `rolloverInFlight` (already cleared) and the reactive cap — fires a **second, redundant rollover**. The user sees a card born, decorated once (`Run linting checks ⏱ 0s`), then abandoned ("Something went wrong") as a new card "continues" milliseconds later. The 4-minute churn also caps total streamed runtime at `MAX_PREEMPTIVE_ROLLOVERS × 4min`, and the reactive cap of 2 silently freezes long runs into a one-shot fallback post.

We want streamer cards to roll over **only when the stream actually expires**, with **no cap** on how many rollovers a long task may incur ("if it's taking too long, so be it"), and **exactly one** rollover per expiry.

## What Changes

- **Remove preemptive rollover entirely.** Delete the 4-minute timer, its constants (`PREEMPTIVE_ROLLOVER_INTERVAL_MS`, `MAX_PREEMPTIVE_ROLLOVERS`), `preemptiveRolloverCount`, `schedulePreemptiveRollover()`, `clearPreemptiveTimer()`, and the `preemptive` branch of `rollover()`. A stream now lives until Slack expires it; the keepalive (every 15s) ensures expiry is detected and recovered within 15s.
- **Remove the reactive rollover cap.** Reactive rollover becomes **unbounded** — a recoverable append failure always rolls over (no `MAX_REACTIVE_ROLLOVERS` ceiling, no give-up-to-fallback on a healthy-but-expired stream). A long task may open as many continuation cards as it needs.
- **Add a stream-generation guard so one expiry produces one rollover.** `SlackStreamer` tracks a monotonic `generation`, bumped on each successful stream open. `append()` snapshots the generation before its call; on a recoverable failure it rolls over only if the generation is unchanged (it was the first to discover this stream died). Stale appends from an already-rolled-over generation replay onto the current stream instead of triggering a duplicate rollover. This eliminates the double-card race.
- **BREAKING (internal only):** removes preemptive-rollover behavior and the reactive cap that other code/tests assert against; no external API or Slack-visible contract changes beyond fewer/cleaner cards.

## Capabilities

### New Capabilities

(none — this refines existing streaming behavior)

### Modified Capabilities

- `streaming-responses`: remove the **Preemptive Stream Rollover** requirement and the **MAX_REACTIVE_ROLLOVERS Constant** cap; make reactive rollover unbounded; add a **stream-generation guard** requirement that collapses concurrent recoverable-failure rejections from one expired stream into a single rollover. Update the Stream Lifecycle, Stream Keepalive, expiry-diagnostics, and cleanup scenarios that currently reference the preemptive timer / reactive cap.

## Impact

- **Code:** `src/streaming/slackStreamer.ts` (rollover, append, keepalive, constants, diagnostics), `src/slack/handlers/delivery/streamingDelivery.ts` (unchanged contract, verify), and any worker-flow streamer construction.
- **Tests:** `src/streaming/slackStreamer.test.ts` and related — remove preemptive-rollover and reactive-cap assertions, add generation-guard race coverage.
- **No change** to delivery handlers, the rollover-block-retention behavior (cards still stay), `getAllMessageTss()`, or skip/cancel cleanup.
