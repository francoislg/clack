# Delivery Handler Specification

## Purpose

Abstract the mechanism for delivering a turn's response (streaming card finalization or silent post) and managing progress surfaces, enabling runtime switching between delivery modes and decoupling response delivery from streamer state management.
## Requirements
### Requirement: Delivery Handler Abstraction

The system SHALL deliver a turn's progress surface and final primary response through a `DeliveryHandler` abstraction with exactly four operations — `windUp()`, `handleEvent(event)`, `deliver(payload)`, `windDown(opts?)`. A handler SHALL own ONLY the progress surface and how the final primary blocks land; it SHALL NOT own the mode-agnostic concerns (the already-delivered guard, reaction adding, the response-notification ping decision, follower delivery, or `post_to` auto-execution), which remain in the orchestrator and operate on the `ts` returned by `deliver`.

`windUp()` SHALL open the handler's surface (for streaming, post and start the live card; for silent, do nothing). `handleEvent(event)` SHALL apply a progress tick to the surface. `deliver(payload)` SHALL land the final answer and return either `{ ok: true, ts?, notified }` or `{ ok: false, error }`, where `notified` reports whether the delivery itself produced a Slack notification. A handler MAY land the answer by whatever mechanism fits its surface — the streaming handler finalizes its live in-thread card in place; the silent handler (and the streaming fallback) posts the final blocks via `chat.postMessage` — but the **landing target SHALL be honored identically**: when a thread anchor is supplied the answer lands in that thread (`thread_ts`), and when it is absent the answer lands at channel top level. `windDown(opts?)` SHALL close the surface WITHOUT delivering anything: `{ discard: true }` removes every message the surface opened (skip / cancel / switch-away), while the default (`discard` absent/false) freezes the surface in place (error / safety net). `windDown` SHALL be idempotent.

#### Scenario: Streaming handler finalizes the live card in place

- **GIVEN** a turn running with the streaming handler whose card is live
- **WHEN** the orchestrator calls `deliver(payload)`
- **THEN** the handler finalizes the existing card in place and returns its `ts`
- **AND** the orchestrator applies reactions and followers on that `ts`

#### Scenario: Streaming deliver falls back internally on streamer failure

- **GIVEN** a streaming handler whose underlying stream has failed, with thread anchor `T`
- **WHEN** `deliver(payload)` is called
- **THEN** the handler posts the final blocks via `chat.postMessage` with `thread_ts: T` internally and returns that `ts`
- **AND** the orchestrator is oblivious to the fallback (it only sees a `ts`)

#### Scenario: Silent handler posts directly with no surface, honoring the thread anchor

- **GIVEN** a turn running with the silent handler with thread anchor `T`
- **WHEN** `windUp()` and `handleEvent(...)` are called
- **THEN** no Slack message and no progress card are created
- **AND** `deliver(payload)` posts the final blocks via `chat.postMessage` with `thread_ts: T` and returns its `ts`

#### Scenario: windDown abandons the surface without delivering

- **GIVEN** a turn running with the streaming handler whose card is live
- **WHEN** the orchestrator calls `windDown()` (e.g. on skip, cancel, or a mode switch)
- **THEN** the handler removes its surface (stops and deletes every message it opened)
- **AND** no final answer is delivered by that call

### Requirement: The deliver Result's notified Flag Drives The Ping Decision

The orchestrator SHALL decide whether to send a separate response-notification ping by reading the `notified` flag on the handler's `deliver` result. A delivery that produced a real Slack message (a `chat.postMessage`) SHALL report `notified: true`; a streaming in-place finalize (a message edit, which does not trigger a Slack notification) SHALL report `notified: false`. The orchestrator SHALL send the follow-up ping only when `notified` is `false`. This is per-delivery, not a static mode property — a streaming handler that falls back to `chat.postMessage` reports `notified: true` for that delivery.

#### Scenario: Streaming in-place finalize may send a separate ping

- **GIVEN** a streaming turn whose card finalizes in place, exceeding the notification threshold, with the user opted in
- **WHEN** delivery completes with `notified: false`
- **THEN** the orchestrator sends the follow-up ping

#### Scenario: A real post never sends a redundant ping

- **GIVEN** a silent turn (or a streaming fallback that posted a real message)
- **WHEN** delivery completes with `notified: true`
- **THEN** the orchestrator does NOT send a separate ping

### Requirement: Handler Selection And Mid-Run Switching

The system SHALL select a turn's initial handler from the resolved session's `deliveryMode` (`"invisible"` → silent, otherwise streaming) and call `windUp()` before Claude runs. Stream events SHALL be routed through a stable callback that forwards to whichever handler is currently active, so a handler installed mid-run begins receiving events. The system SHALL expose a `setDelivery(next)` primitive that performs `windDown()` on the current handler, installs `next`, then calls `windUp()` on it.

#### Scenario: Initial handler chosen from session deliveryMode

- **GIVEN** a turn whose resolved session has `deliveryMode: "invisible"`
- **WHEN** the turn starts
- **THEN** the silent handler is selected and wound up (no live card appears)

#### Scenario: A handler installed mid-run receives subsequent events

- **GIVEN** a turn that started with the silent handler
- **WHEN** `setDelivery(streaming)` runs mid-turn and a later tool event is emitted
- **THEN** the new streaming handler receives that event and reflects it on its card
- **AND** events emitted before the switch are not retroactively shown

#### Scenario: setDelivery tears down the old surface before opening the new one

- **GIVEN** a turn running with the streaming handler whose card is live
- **WHEN** `setDelivery(silent)` runs
- **THEN** the streaming card is torn down (windDown) and the silent handler is wound up
- **AND** the final answer for the turn is delivered silently

### Requirement: post_top_level Reuses windDown

When a turn delivers at channel top level, the system SHALL tear down the active handler's surface via `windDown()` and then post the final blocks top-level (with no `thread_ts`) and create the follow-up session, rather than hand-rolling streamer teardown. The observable result SHALL match the prior behavior: the in-thread progress footprint is removed and a fresh top-level message is posted.

#### Scenario: Top-level delivery removes the in-thread surface

- **GIVEN** a streaming turn whose card opened one or more in-thread messages
- **WHEN** the response is delivered with `post_top_level: true`
- **THEN** every in-thread message the handler opened is removed via `windDown()`
- **AND** the final blocks are posted top-level with no `thread_ts`

### Requirement: Landing Target Is Independent Of Progress Mode

The landing target of a turn's primary response — in-thread (a `thread_ts`) versus top-level (no `thread_ts`) — SHALL be an input supplied to the active `DeliveryHandler` by the orchestrator, derived from session/turn context independent of the resolved `deliveryMode`. Every handler SHALL honor that landing target identically: land threaded when a thread anchor is supplied, land top-level when it is absent. The choice of handler (streaming vs. silent) SHALL NOT affect where the primary response lands — it governs only whether a live progress surface is shown (and, as an internal consequence, whether the final answer is finalized in place on that surface or posted fresh). Consequently all four combinations — {streaming, silent} × {in-thread, top-level} — SHALL be expressible.

#### Scenario: Silent delivery in an engaged thread lands in that thread

- **GIVEN** a turn for an engaged session `(C1, T)` resolved to the silent handler, with thread anchor `T`
- **WHEN** `deliver(payload)` runs
- **THEN** the final blocks are posted via `chat.postMessage` with `thread_ts: T`
- **AND** the message lands inside thread `T`, not at channel top level

#### Scenario: Silent delivery with no thread anchor lands top-level

- **GIVEN** a turn resolved to the silent handler with no thread anchor supplied
- **WHEN** `deliver(payload)` runs
- **THEN** the final blocks are posted via `chat.postMessage` with no `thread_ts`
- **AND** the message lands at channel top level

#### Scenario: Switching modes does not change the landing target

- **GIVEN** a turn for an engaged thread `T` whose landing target is `T`
- **WHEN** the active handler is the silent handler on one turn and the streaming handler on the next
- **THEN** both turns deliver their primary response into thread `T`
- **AND** the only observable difference is the presence or absence of the live progress card

