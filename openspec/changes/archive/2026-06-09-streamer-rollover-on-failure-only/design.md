## Context

`SlackStreamer` (`src/streaming/slackStreamer.ts`) keeps a Slack `chatStream` open for the life of a Claude query, posting tool-progress task cards and finalizing the answer in place. Because a `chatStream` has a hard ~5-minute TTL, the streamer currently uses two rotation mechanisms:

- **Reactive rollover** — on a recoverable append failure (`message_not_in_streaming_state` / `message_not_found`), open a fresh stream and replay the failing chunk. Capped at `MAX_REACTIVE_ROLLOVERS = 2`.
- **Preemptive rollover** — a 4-minute timer (`PREEMPTIVE_ROLLOVER_INTERVAL_MS`) that rotates the stream *before* the TTL elapses, regardless of health. Capped at `MAX_PREEMPTIVE_ROLLOVERS = 20`.

`handleEvent` and the 15-second keepalive call `append()` **fire-and-forget** (never awaited), so multiple appends are routinely in flight against the same stream. Two failure modes follow:

1. **Double-card race.** When a rollover (preemptive or reactive) advances the stream, a stale append still bound to the *old* stream rejects. Its catch sees `rolloverInFlight` already cleared and the cap not yet hit, so it fires a **second** rollover — abandoning the just-opened block after a single `⏱ 0s` re-emit and "continuing" on yet another card.
2. **Premature give-up.** The reactive cap of 2 means a long task (worker lint/test/build runs of 15+ minutes) exhausts both rollovers and freezes into a `chat.postMessage` fallback, even though the only problem was a routine TTL expiry.

The product decision (confirmed with the user): rollover **only** on real expiry, with **no cap**, and **exactly one** rollover per expiry.

## Goals / Non-Goals

**Goals:**
- Eliminate preemptive rollover and its 4-minute churn.
- Make reactive rollover unbounded — a long-running task may roll over as many times as Slack expires its stream.
- Guarantee a single expired stream yields exactly one rollover (one new card), regardless of how many appends were in flight when it died.

**Non-Goals:**
- Changing the rollover-block-retention behavior — prior blocks still stay in the thread (intended).
- Touching delivery handlers, `getAllMessageTss()`, or skip/cancel cleanup.
- Trying to *prevent* expiry (e.g. by tuning keepalive cadence) — we accept expiry and recover from it cleanly.

## Decisions

### Decision 1: Remove preemptive rollover rather than make it race-safe

The preemptive timer exists to dodge the TTL, but the keepalive already pokes the stream every 15s, so a dead stream is detected within 15s and recovered reactively. Reactive-only rollover produces one clean "Continuing previous stream…" card per real expiry (~every 5 min of streaming) instead of a forced rotation every 4 min. Removing it deletes a whole class of timing bugs (timer-vs-append races) outright.

**Alternative considered:** keep preemptive but gate it behind the generation guard. Rejected — it still rotates healthy streams unnecessarily and adds churn for no benefit once the generation guard makes reactive rollover reliable.

### Decision 2: Unbounded reactive rollover

Remove `MAX_REACTIVE_ROLLOVERS`. The cap's original purpose was anti-flapping, but flapping is already prevented by the generation guard (a single expiry can no longer trigger multiple rollovers) and by the keepalive interval (rollovers are paced by real ~5-min expiries, not by a tight loop). A task that streams for an hour simply opens ~12 continuation cards. "If it's taking too long, so be it."

**Alternative considered:** raise the cap to ~20. Rejected — any finite cap reintroduces the silent give-up-to-fallback for genuinely long runs, which is exactly the failure the user wants gone.

### Decision 3: Monotonic stream-generation guard

Add `private generation = 0`, incremented immediately after each successful `openChatStream()` (in both `start()` and `rollover()`). In `append()`:

```
const gen = this.generation;          // snapshot before the await
try { await this.chatStreamer.append(...) }
catch (e) {
  if (this.stopped) return;
  if (stopped_by_user) { ...halt... }
  if (recoverable) {
    if (this.generation !== gen) {     // someone already rolled this stream over
      // replay our chunks onto the CURRENT stream, no new rollover
      return this.replayOnCurrent(chunks);
    }
    await this.rollover();             // we're first to find this generation dead
    ...replay...
  }
}
```

The guard makes rollover idempotent per stream generation: the first rejecting append rolls over and bumps `generation`; every other stale append from the same generation falls into the `generation !== gen` branch and replays instead of re-rolling. `rolloverInFlight` is retained as the intra-tick mutex (covers the window between an append discovering death and the new stream opening); the generation guard covers the post-rollover window the mutex misses.

**Alternative considered:** serialize all appends through a single-flight promise chain. Deferred — it also fixes the race but is a larger behavioral change (ordering, backpressure) and isn't required once the generation guard is in. Could be a follow-up if append ordering ever matters.

## Risks / Trade-offs

- **Unbounded rollovers on a pathological flapping stream** → Mitigated by the generation guard (one rollover per expiry) + the 15s keepalive pacing. A stream that dies instantly on every open would still loop, but that already enters failed state via the rollover-open-failure path (a *failed open* is not recoverable and sets `failed = true`), so the loop is bounded by open failures, not by the cap.
- **Replay-on-current path could append stale chunks out of order** → Low impact: task updates are last-writer-wins by `id`; a late re-emit of an in-flight task is harmless. Drop `THINKING_TASK_ID` chunks from replay as today.
- **Removing constants/scenarios breaks existing tests** → Expected; tests are updated as part of the change. The expiry-diagnostics log loses `preemptiveRolloverCount`.

## Migration Plan

Pure code change, no data migration. Deploy via the normal image rollout. Rollback = redeploy the prior image. No persisted state or config keys involved.

## Open Questions

- Should the expiry diagnostics log keep a `reactiveRolloverCount` (now unbounded) for observability? Recommend **yes** — it becomes a useful "how many times did this run expire" signal, and per Decision in the spec we add a per-rollover log line.
