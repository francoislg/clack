## Context

Delivery of a turn's primary response runs through a `DeliveryHandler` (`src/slack/handlers/delivery/`). Two implementations exist: `StreamingDelivery` (a live `SlackStreamer` card) and `SilentDelivery` (no surface). The orchestrator in `handlerResponse.ts` selects one from the session's `deliveryMode` and computes `targetThread = dmThreadTs ?? threadTs`.

Today only `StreamingDelivery` receives `targetThread`. Its own no-streamer `chat.postMessage` fallback posts with `thread_ts: targetThread` — i.e. "streaming without a surface" still threads. `SilentDelivery`, by contrast, is constructed with `targetChannel` but **not** `targetThread`, and its `deliver` posts with no `thread_ts`. That top-level behavior is a fossil: silent delivery began as the cron-post path (the pre-refactor comment read *"posts directly via chat.postMessage without thread_ts. Used for silentThinking mode (e.g., cron jobs)"*), where a fresh top-level announcement is correct. The `DeliveryHandler` refactor preserved the coupling without re-examining it once silent delivery started serving thread-following replies.

The result: an engaged thread with `deliveryMode: "invisible"` (e.g. casual-talk) answers replies top-level instead of in-thread.

## Goals / Non-Goals

**Goals:**
- Make landing target (in-thread vs. top-level) independent of progress mode (streamer vs. silent). All four combinations expressible.
- `SilentDelivery` honors the turn's thread anchor identically to `StreamingDelivery`.
- Selecting silent vs. streaming changes only whether a progress surface appears.

**Non-Goals:**
- No change to how cron / channelless runs post (they deliver via `deliver_to`/`post_to` with explicit targets, never the silent primary landing).
- No change to the explicit `post_top_level` path or the `deliver_to`/`thread_replies` follower paths.
- No new config, schema, delivery mode, or migration. `deliveryMode` keeps its two values; its meaning narrows to "show a progress surface or not."

## Decisions

**Decision 1 — Landing target is a handler input, not a mode property.**
Add an optional thread anchor to `SilentDeliveryOptions` (matching `StreamingDeliveryOptions.targetThread`). In `deliver`, post with `...(targetThread && { thread_ts: targetThread })`. The orchestrator passes `targetThread` to both handlers in `handlerFor(...)`. Both `deliver` bodies become the same `chat.postMessage` shape; the streamer simply finalizes its card (already in-thread) when it has one.

- *Why optional rather than always-thread?* The handler must support both landings so a top-level silent post (anchor absent) remains expressible — "both must be supported." The orchestrator decides; the handler obeys.
- *Alternative considered — always thread in silent.* Rejected: it would make silent structurally incapable of top-level, re-coupling the axes in the opposite direction.
- *Alternative considered — collapse both handlers into one parameterized by a `showProgress` boolean.* Rejected as larger than needed; the `DeliveryHandler` interface already isolates the difference, and the streamer carries surface lifecycle state the silent path doesn't.

**Decision 2 — The orchestrator derives the landing target once, mode-independently.**
`targetThread` is already computed (`dmThreadTs ?? threadTs`) before handler selection. Selection reads `deliveryMode`; the anchor does not. This is the single central point the `thread-delivery-mode` spec already requires for mode selection — the anchor rides the same seam.

**Decision 3 — `responseTs` recording is conditional on a top-level landing.**
`SilentDelivery` records `responseTs` so replies to a top-level silent post can find the session. When the post is threaded, replies are found via `findSessionByThread(channel, threadTs)`, so `responseTs` is redundant. Record it only when no thread anchor was used. (Recording it unconditionally is harmless but misleading; gating it keeps the reply-anchor story coherent.)

## Risks / Trade-offs

- **[A real-channel silent session today relies on top-level posting]** → Evidence says none does: cron/channelless never invoke the silent primary landing (`handlerResponse.ts` skips it when `isChannellessChannelId(targetChannel)`), and explicit top-level uses the separate `post_top_level` branch. The only real-channel silent primary landing is an engaged-thread reply, which *wants* threading. Mitigation: the anchor is optional, so any future top-level-silent caller can omit it.
- **[Reply discovery regresses for the changed posts]** → Threaded silent posts are discovered via `findSessionByThread` (the engaged-session path that already drives these threads); top-level silent posts keep `responseTs`. Covered by tests for both landings.
- **[`thread_ts` points at a stale/deleted root]** → Same exposure `StreamingDelivery` already has; `chat.postMessage` errors surface through the existing `{ ok: false }` path. No new risk.
