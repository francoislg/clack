## 1. Define the abstraction

- [x] 1.1 Add `DeliveryHandler` interface (`windUp()`, `handleEvent(StreamEvent)`, `deliver(payload): Promise<{ ok; ts? } | { ok: false; error }>`, `windDown()`, `readonly deliversOwnNotification: boolean`) — likely `src/streaming/delivery/types.ts`.
- [x] 1.2 Document (JSDoc) that the interface is designed to also fit a future `EditMessageDelivery` (post placeholder → throttled `chat.update` → final update → delete), without implementing it.

## 2. Extract the two handlers (behavior-parity)

- [x] 2.1 `StreamingDelivery` — wraps the existing `SlackStreamer`: `windUp`=`start`, `handleEvent`=`streamer.handleEvent`, `deliver`=`stop({blocks})`+`getMessageTs` with the `hasFailed`→`chat.postMessage` fallback hidden INSIDE `deliver`, `windDown`=`stop()`+delete every `getAllMessageTss()`. `deliversOwnNotification = false`.
- [x] 2.2 `SilentDelivery` — `windUp`/`handleEvent`/`windDown` = noop, `deliver`=`chat.postMessage` (+ `updateSession({ responseTs })` as today). `deliversOwnNotification = true`.
- [x] 2.3 Unit tests for both handlers, including `StreamingDelivery.deliver` falling back when the streamer has failed (it must still return a `ts`).

## 3. Refactor the orchestrator onto handlers

- [x] 3.1 `handlerResponse.ts` — select the initial handler from the resolved session's `deliveryMode` (`"invisible"`/explicit `silentThinking` → `SilentDelivery`, else `StreamingDelivery`) and `await handler.windUp()` where the streamer is created today.
- [x] 3.2 Collapse `buildDeliverFn` + `buildDirectDeliverFn` into ONE deliver path: call `handler.deliver(payload)`, then run the mode-agnostic work on the returned `ts` (already-delivered guard, reactions, followers). Read `handler.deliversOwnNotification` to decide the response-ping.
- [x] 3.3 Route `skip`/`cancel` through `handler.windDown()`; reroute `post_top_level` to `handler.windDown()` + top-level post + follow-up session creation (remove the hand-rolled streamer teardown).
- [x] 3.4 Replace the once-bound `onEvent` with a stable closure `(e) => current.handleEvent(e)` that reads the active handler live.
- [x] 3.5 Add `setDelivery(next)` = `await current.windDown(); current = next; await current.windUp()`.
- [x] 3.6 Confirm the ~61 existing `handlerResponse` tests pass UNCHANGED (parity). Adapt only test scaffolding that mocked the two deliver functions, never the asserted behavior.

## 4. Mid-run switch plumbing

- [x] 4.1 Build a `deliveryControl = { switchTo(mode): Promise<void> }` in `executeAndDeliver` that closes over `setDelivery`, the handler factory, and a `deliveryMode` persistence call; idempotent no-op when `mode` is already active; ignore switches after `deliver` has run.
- [x] 4.2 Thread `deliveryControl` into the tool build context (`src/tools/types.ts` tool context, `src/tools/server.ts` assembly) for interactive triggers only.

## 5. switch_delivery_context tool

- [x] 5.1 Add the `switch_delivery_context` MCP tool (arg: `mode: "streamer" | "invisible"`; calls `ctx.deliveryControl.switchTo(mode)`; returns a non-terminal `textResult`). Claude-facing English description.
- [x] 5.2 Gate it to interactive triggers (present for mentions/reactions/DM/auto-respond/thread-reply; absent in channelless cron + worker contexts).
- [x] 5.3 Tests: invisible→streamer surfaces a card mid-turn + persists `deliveryMode`; streamer→invisible tears down + persists; same-mode is a no-op; tool absent in non-interactive contexts.

## 6. Verify

- [x] 6.1 `npx tsc` — type-check passes.
- [x] 6.2 `npm test` — full suite green (parity + new).
- [x] 6.3 `npx oxlint` + `npx oxfmt --check` on touched files.
- [x] 6.4 `openspec validate add-delivery-handler-abstraction --strict`.
