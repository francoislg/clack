## Why

Today the live-progress "streamer" and the silent "direct post" modes are two near-duplicate functions — `buildDeliverFn` (streamer) and `buildDirectDeliverFn` (silent) in `handlerResponse.ts`. Both reimplement the *mode-agnostic* parts of delivery (the `alreadyDelivered` guard, follower delivery, reaction-adding, the `chat.postMessage` fallback, error handling); the only genuine difference is ~10 lines of "how the final blocks land." That duplication makes the delivery path harder to evolve and impossible to switch at runtime.

Two forces motivate consolidating now:

1. **Zero-turn delivery switching.** `add-thread-delivery-mode` shipped a *next-turn* switch (`default_delivery_mode` on the session, read at turn start). But a thread that starts as casual chatter and turns into real work should be able to surface the live streamer **on the same turn** Claude realizes it. The streamer is created before Claude runs, so the only way to honor a mid-turn switch is to tear down the current surface and open a new one in-flight — which the two-function design can't express.
2. **A future third mode.** A lighter "edit-message" progress UX (post a placeholder, `chat.update` it as tools run — no streaming API) is plausible. With two copy-pasted functions, adding a third means a third copy.

A small delivery abstraction solves both: each mode becomes a self-contained handler, the orchestrator keeps the shared concerns once, and switching modes (at turn start OR mid-run) is a uniform `windDown(old)` + `windUp(new)`.

## What Changes

- Introduce a `DeliveryHandler` interface with four verbs — `windUp()`, `handleEvent(StreamEvent)`, `deliver(payload)`, `windDown()` — plus one explicit mode-specific flag, `deliversOwnNotification`. The handler owns ONLY the progress surface and how the final primary blocks land; everything else stays in the orchestrator.
- Extract two handlers behind it: `StreamingDelivery` (wraps the existing `SlackStreamer`, including its `hasFailed` → `chat.postMessage` fallback) and `SilentDelivery` (no surface; direct post). This is a **behavior-parity refactor** — `buildDeliverFn` + `buildDirectDeliverFn` collapse into one orchestration path that calls `handler.deliver(...)` then does the mode-agnostic work (reactions, response-ping, followers, `post_to`) on the returned `ts`.
- Wire `onEvent` as a **stable closure** that reads the current handler live (`(e) => current.handleEvent(e)`), and add `setDelivery(next)` = `await current.windDown(); current = next; await current.windUp()`. This is the one mechanism that makes both startup selection and mid-run switching work.
- Add a `switch_delivery_context` MCP tool (gated to interactive triggers) that calls a thin `deliveryControl.switchTo(mode)` handle threaded into the tool context. It swaps the handler **now** AND persists `session.deliveryMode` so future turns follow. It coexists with `submit_response.default_delivery_mode` (which persists only, no in-flight action).
- **Design for** a future `EditMessageDelivery` (document that the four-verb interface fits it) but do NOT implement it.

## Capabilities

### New Capabilities

- `delivery-handler`: a per-turn delivery abstraction (streamer vs silent vs future edit-message) selected at turn start from `session.deliveryMode` and switchable mid-run via `setDelivery`, with the mode-agnostic orchestration (reactions, ping, followers, post_to) kept once around it.
- `switch-delivery-context-tool`: an interactive-only MCP tool that switches the in-flight delivery mode immediately and persists it as the thread default.

### Modified Capabilities

- `thread-delivery-mode`: the `default_delivery_mode` session field is now consumed by the handler factory at turn start (it selects the initial handler) and is also the persistence target the in-flight switch writes; the next-turn `submit_response` switch is unchanged and coexists with the new in-flight tool.

## Impact

- Code (hot path): new `DeliveryHandler` interface + `StreamingDelivery`/`SilentDelivery` (likely under `src/streaming/delivery/`), refactor of `executeAndDeliver`/`buildDeliverFn`/`buildDirectDeliverFn` in `handlerResponse.ts`, a `deliveryControl` seam threaded into the tool build context (`src/tools/server.ts` / `src/tools/types.ts`), and the new `switch_delivery_context` tool.
- Backward compatible: behavior-identical for every existing trigger. The refactor must land parity-first (the ~61 `handlerResponse` tests are the harness), with the switch tool layered on top in the same change.
- Builds directly on `add-thread-delivery-mode`.
