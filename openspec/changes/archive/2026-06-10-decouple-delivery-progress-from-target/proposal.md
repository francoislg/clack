## Why

`deliveryMode: "invisible"` currently conflates two orthogonal decisions: whether a progress surface is shown (streamer card vs. nothing) AND where the answer lands (in-thread vs. top-level). `SilentDelivery` was lifted from the old cron-post path and hardwires top-level posting (no `thread_ts`), so an engaged thread running silently — e.g. a casual-talk follow-up — gets its reply posted to the channel top-level instead of into the thread the user is talking in. The two concerns should be independent: progress reporting is the *only* thing that distinguishes the handlers; the landing target is a separate input that every handler honors identically.

Note this is NOT a "collapse the handlers" change. The two handlers' `deliver` is genuinely different on the happy path — `StreamingDelivery` finalizes its live card in place via the streamer (`stop`/`.end`, an edit that does not notify), while `SilentDelivery` posts a fresh message. The overlap is only streaming's *fallback* (a from-scratch `chat.postMessage` when the card failed). So `deliver` rightly stays on each handler; the fix is narrow — silent's fresh post must carry the thread anchor.

## What Changes

- Treat **landing target** (in-thread vs. top-level) and **progress reporting** (streamer card vs. silent) as two independent axes. All four combinations are valid and expressible.
- `SilentDelivery` SHALL accept the turn's thread anchor and post with `thread_ts` when one is present, and top-level (no `thread_ts`) when it is absent — exactly mirroring `StreamingDelivery`'s own `chat.postMessage` fallback. The handler no longer hardwires top-level.
- The orchestrator SHALL pass the same landing target to whichever handler is active, derived from session/turn context independent of `deliveryMode`. Selecting silent vs. streaming SHALL change *only* whether a progress surface appears, never where the answer lands.
- Top-level primary delivery remains available to both modes via the existing explicit paths (`post_top_level`, `deliver_to` with no `thread_ts`); those paths become genuinely mode-agnostic rather than implicitly tied to "invisible."
- `responseTs` recording (the reply anchor for a top-level silent post) SHALL apply only when the silent post actually lands top-level; a threaded silent post is rediscovered via the existing `findSessionByThread` path.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `delivery-handler`: the silent handler's `deliver` is redefined to honor a thread anchor (post threaded when present, top-level when absent), and a new requirement establishes that progress reporting is the sole behavioral difference between handlers — landing target is a shared, mode-independent input.
- `thread-delivery-mode`: clarify that selecting the silent handler for an engaged thread suppresses only the progress card; the reply still lands in the engaged thread, not top-level.

## Impact

- `src/slack/handlers/delivery/silentDelivery.ts` — add the thread anchor to `SilentDeliveryOptions`; post with `thread_ts` when present; make `responseTs` recording conditional on a top-level landing.
- `src/slack/handlers/handlerResponse.ts` — pass `targetThread` into `SilentDelivery` (line ~178, where it is currently omitted), symmetric with `StreamingDelivery`.
- `src/slack/handlers/delivery/silentDelivery.test.ts`, `handlerResponse.test.ts` — cover silent-in-thread and silent-top-level.
- No config, schema, or migration changes. Cron / channelless top-level posting is unaffected (it flows through `deliver_to`/`post_to`, never the silent primary landing).
