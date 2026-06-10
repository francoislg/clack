## 1. SilentDelivery honors a thread anchor

- [x] 1.1 Add an optional `targetThread?: string` to `SilentDeliveryOptions` in `src/slack/handlers/delivery/silentDelivery.ts`, documented to mirror `StreamingDeliveryOptions.targetThread`.
- [x] 1.2 In `SilentDelivery.deliver`, post via `chat.postMessage` with `...(targetThread && { thread_ts: targetThread })` so a threaded session lands in-thread and an anchorless one lands top-level.
- [x] 1.3 Make `recordResponseTs` fire only when no `targetThread` was used (top-level landing); skip it for threaded posts, where `findSessionByThread` is the reply anchor. Update the field doc-comment to match.

## 2. Orchestrator passes the landing target uniformly

- [x] 2.1 In `src/slack/handlers/handlerResponse.ts` `handlerFor(...)`, construct `SilentDelivery` with `targetThread` (the already-computed `dmThreadTs ?? threadTs`), symmetric with `StreamingDelivery`.
- [x] 2.2 Confirm `targetThread` is derived independently of `deliveryMode` and that mode selection touches only handler choice (no behavioral coupling to the anchor). Mid-run switches reuse the same `handlerFor` closure, so a switch into silent also threads.

## 3. Tests

- [x] 3.1 `silentDelivery.test.ts`: assert `deliver` posts with `thread_ts` when `targetThread` is set, and with no `thread_ts` when it is absent.
- [x] 3.2 `silentDelivery.test.ts`: assert `responseTs` is recorded only for the top-level (anchorless) landing, not the threaded one.
- [x] 3.3 `handlerResponse.test.ts`: assert a silent (invisible) engaged-thread turn delivers into the thread (silent + in-thread); streaming-in-thread is already covered by existing thread_ts assertions.
- [x] 3.4 Mid-run switch into silent threads via the shared `handlerFor` closure (covered by the existing switch tests plus the in-thread delivery assertion).

## 4. Verify

- [x] 4.1 `npx tsc` clean for changed files; `npx oxlint` + `npx oxfmt --check` on changed files pass.
- [x] 4.2 Delivery + handlerResponse suites green (71 tests). Full-suite `npm test` not run here: an unrelated in-progress zod migration (`src/config.ts` et al.) leaves the tree red independent of this change.
- [x] 4.3 `openspec validate decouple-delivery-progress-from-target --strict` passes.
- [x] 4.4 Repro covered by automated test (silent invisible turn lands in-thread, no card) in lieu of a live Slack check.
