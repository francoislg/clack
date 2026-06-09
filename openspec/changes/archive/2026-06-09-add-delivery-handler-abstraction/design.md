# Design

## The boundary that keeps it simple

The entire design rests on one line: **the handler owns only the progress surface + how the final primary blocks land. Nothing else.**

```
┌─ DeliveryHandler — the ONLY thing that varies by mode ─────────────┐
│   windUp(): Promise<void>            open the surface              │
│   handleEvent(e: StreamEvent): void  progress tick                │
│   deliver(payload): Promise<Result>  land the final answer → ts   │
│   windDown(): Promise<void>          tear surface down, deliver 0  │
│   readonly deliversOwnNotification: boolean                       │
└────────────────────────────────────────────────────────────────────┘

stays in executeAndDeliver, operating on the returned `ts` — MODE-AGNOSTIC:
   alreadyDelivered guard · reactions · response-ping · followers
   (additional_messages / thread_replies) · post_to auto-execute · error reporting
```

If the handler stays this narrow, the change is a net simplification: today's `buildDeliverFn` (~90 lines) and `buildDirectDeliverFn` (~50 lines) are near-duplicates of the mode-agnostic concerns. They collapse into ONE orchestration path plus two small handlers. If the handler creeps wider (absorbing followers/post_to/error reporting), it bloats and the refactor loses its point. **Holding this line is the acceptance criterion, not a nicety.**

## The lifecycle

```
turn start
   current = handlerFor(session.deliveryMode)   // "invisible"→SilentDelivery, else StreamingDelivery
   await current.windUp()
        │
        ▼  askClaude runs, emits StreamEvents
   onEvent = (e) => current.handleEvent(e)        // STABLE closure — reads `current` live
        │
        ├─ [optional, mid-run] switch_delivery_context(mode)
        │     deliveryControl.switchTo(mode):
        │        if mode === currentMode: return   // idempotent no-op
        │        await setDelivery(handlerFor(mode))
        │        await persistDeliveryMode(mode)    // future turns follow too
        │
        ▼  submit_response(blocks)
   result = await current.deliver(payload)         // returns { ok, ts }
        │
        ▼  MODE-AGNOSTIC orchestration on result.ts (unchanged, now deduplicated)
   reactions · (ping if !current.deliversOwnNotification) · followers · post_to

skip / cancel  → await current.windDown()
post_top_level → await current.windDown(); then post top-level + create follow-up session
```

`setDelivery(next)` is the single swap primitive:

```
setDelivery(next):
   await current.windDown()   // tear down old surface, deliver nothing
   current = next
   await current.windUp()     // open new surface
```

It is used in exactly two places: nowhere at startup (startup just calls `windUp` on the chosen handler), and inside `deliveryControl.switchTo`. `deliver()` is called once, at the end, on whatever handler is `current`.

## Why `deliver` and `windDown` stay separate

Both "close the surface," but they are not the same operation:

- `deliver(payload)` — the happy path. Lands the final answer and returns a `ts` the orchestrator needs (for reactions/followers/notifications).
- `windDown()` — abandon the surface, deliver nothing, return nothing. Used for skip, cancel, `post_top_level` teardown, and switching away mid-run.

Collapsing them into `windDown(blocks?)` reads clever but muddies the happy path's `ts` contract and conflates "finish" with "discard." Keep them distinct.

## The stable `onEvent` closure — the load-bearing wiring change

```
   TODAY:       onEvent: streamer?.handleEvent ?? (() => {})    // bound ONCE; if null at start, no-op forever
   ABSTRACTED:  onEvent: (e) => current.handleEvent(e)          // forwards to whatever handler is current
```

A turn that starts silent has `current = SilentDelivery` (handleEvent = noop). When `switch_delivery_context("streamer")` runs, `current` becomes a freshly wound-up `StreamingDelivery`, and the SAME `onEvent` closure now feeds it events. Without this indirection, a late-created streamer would never receive events. This is the one change to the live streaming wiring and the highest-risk line in the change.

## The `deliveryControl` seam (the only new cross-layer coupling)

The MCP tool lives in `src/tools/`; the handlers live in the Slack-handler layer. The tool must not import a streamer. So `executeAndDeliver` constructs a thin handle and passes it into the tool build context:

```ts
deliveryControl = {
  switchTo(mode: DeliveryMode): Promise<void>   // closes over setDelivery + handlerFor + persist
}
```

`switch_delivery_context(mode)` simply calls `ctx.deliveryControl.switchTo(mode)` and returns a `textResult`. The tool is gated to interactive triggers only (it is a no-op / absent for channelless cron and worker contexts, where there is no live streaming surface to switch). Gating mirrors how `attention_level` exposure is gated.

## The three modes

```
              windUp              handleEvent          deliver               windDown            deliversOwnNotification
StreamingDelivery  streamer.start  streamer.handleEvent  streamer.stop({blocks}) stop()+delete all ts  false  (edits don't ping)
                   (wraps SlackStreamer; its hasFailed→postMessage fallback hides INSIDE deliver, returning a ts regardless)
SilentDelivery     noop            noop                  chat.postMessage(blocks) noop                 true   (a real post pings)
EditMessageDelivery post "🤔…"      throttled chat.update update(final blocks)    chat.delete(holder)  true   ← DESIGN-FOR ONLY
  (the four-verb interface already fits it; NOT implemented in this change)
```

`deliversOwnNotification` is the single bit of mode-specificity that legitimately lives outside the four verbs — it answers "stream edits don't trigger a Slack notification, so does the orchestrator need to send a separate ping?" Streaming = `false` (needs the ping), Silent/Edit = `true` (their final message already pings). The alternative (a `notify()` method) is heavier for one boolean; the flag is the right tradeoff.

## Relationship to `default_delivery_mode` (shipped)

The session field and the new tool are two altitudes of the same axis and coexist:

| | `submit_response.default_delivery_mode` (shipped) | `switch_delivery_context` (this change) |
|---|---|---|
| When | end of a turn | mid-turn, any time |
| Effect | persist only → **next** turn | swap handler **now** + persist → this + future turns |
| Use | declare future on a skip turn, or without interrupting the stream | the casual→work moment, immediately |

The handler factory reads `session.deliveryMode` at turn start to pick the initial handler — so the shipped field also becomes the *input* to the abstraction, not just a flag read in `core.ts`. (The `core.ts` read can stay as-is for selecting initial mode, or move into the factory; either way the observable behavior is unchanged.)

## Risks and mitigations

- **Hot-path refactor.** Every response flows through `executeAndDeliver`. Mitigation: land the extraction behavior-parity first — the ~61 existing `handlerResponse` tests must stay green untouched — then layer the switch tool. Add explicit tests for the `StreamingDelivery.deliver` failure-fallback path (it now hides inside the handler).
- **Switch flip-flopping.** Claude could switch repeatedly. `switchTo` is idempotent (no-op when already in the target mode); each real switch is a `windDown`+`windUp`, which for Streaming→Silent deletes the card and for Silent→Streaming starts one. Bounded, but worth a guard against pathological churn (e.g., ignore switches after `deliver` has run).
- **`post_top_level` interaction.** Today it manually stops the streamer and deletes its messages. Under the abstraction this becomes `current.windDown()` + post — strictly cleaner, but it must be re-verified against the existing multi-block deletion tests.
- **Over-abstraction.** Guarded by the boundary discipline above and by NOT building `EditMessageDelivery` — the interface is validated by two real modes plus a documented third, not by speculative code.
