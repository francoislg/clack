## MODIFIED Requirements

### Requirement: Delivery Handler Abstraction

The system SHALL deliver a turn's progress surface and final primary response through a `DeliveryHandler` abstraction with exactly four operations — `windUp()`, `handleEvent(event)`, `deliver(payload)`, `windDown(opts?)`. A handler SHALL own ONLY the progress surface and how the final primary blocks land; it SHALL NOT own the mode-agnostic concerns (the already-delivered guard, reaction adding, the response-notification ping decision, follower delivery, or `post_to` auto-execution), which remain in the orchestrator and operate on the `ts` returned by `deliver`.

`windUp()` SHALL open the handler's surface (for streaming, post and start the live card — or, when the streaming handler is wound up in deferred mode, construct the surface without posting until it commits, per the `deferred-progress-surface` capability; for silent, do nothing). `handleEvent(event)` SHALL apply a progress tick to the surface. `deliver(payload)` SHALL land the final answer and return either `{ ok: true, ts?, notified }` or `{ ok: false, error }`, where `notified` reports whether the delivery itself produced a Slack notification. A handler MAY land the answer by whatever mechanism fits its surface — the streaming handler finalizes its live in-thread card in place; the silent handler (and the streaming fallback, including a deferred surface that never committed) posts the final blocks via `chat.postMessage` — but the **landing target SHALL be honored identically**: when a thread anchor is supplied the answer lands in that thread (`thread_ts`), and when it is absent the answer lands at channel top level. `windDown(opts?)` SHALL close the surface WITHOUT delivering anything: `{ discard: true }` removes every message the surface opened (skip / cancel / switch-away), while the default (`discard` absent/false) freezes the surface in place (error / safety net); for a deferred surface that never committed, both forms make no Slack call. `windDown` SHALL be idempotent.

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

#### Scenario: Deferred streaming handler posts nothing at windUp

- **GIVEN** a streaming handler wound up in deferred mode
- **WHEN** `windUp()` returns and no committing event has arrived
- **THEN** no Slack message and no progress card exist
- **AND** `deliver(payload)` from that uncommitted state posts the final blocks via `chat.postMessage` at the landing target and returns `notified: true`

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

### Requirement: Handler Selection And Mid-Run Switching

The system SHALL select a turn's initial handler from the resolved session's `deliveryMode` (`"invisible"` → silent, otherwise streaming) and call `windUp()` before Claude runs. When the streaming handler is selected, the system SHALL additionally decide whether its progress surface opens immediately or **deferred** (see the `deferred-progress-surface` capability), from an explicit caller-supplied flag that defaults to immediate. The message-processing entry point SHALL set that flag from the trigger type of the incoming turn — proactive triggers defer, user-initiated triggers do not — unless its caller supplies an explicit override, which takes precedence. A caller that reuses a proactive trigger type for session semantics while a human is waiting (the plugin SDK's thread-conversation start) SHALL override the flag to immediate; a caller that reuses a user-initiated trigger type for a turn nobody is waiting on (the investigation engine's background rounds) SHALL override it to deferred. Paths that continue an existing session from a button click SHALL NOT derive the flag from the session's stored trigger type. The flag governs only the turn's initial `windUp()`: a later explicit `setDelivery(streaming)` (e.g. via `switch_delivery_context`) always opens immediately, since that call is itself the decision to show a surface. Stream events SHALL be routed through a stable callback that forwards to whichever handler is currently active, so a handler installed mid-run begins receiving events. The system SHALL expose a `setDelivery(next)` primitive that performs `windDown()` on the current handler, installs `next`, then calls `windUp()` on it.

#### Scenario: Initial handler chosen from session deliveryMode

- **GIVEN** a turn whose resolved session has `deliveryMode: "invisible"`
- **WHEN** the turn starts
- **THEN** the silent handler is selected and wound up (no live card appears)

#### Scenario: Deferral decided from the incoming trigger type

- **GIVEN** a message-processing turn resolved to the streaming handler
- **WHEN** the incoming turn's trigger type is `autoRespond`, `threadReply`, or `channelReply`
- **THEN** the streaming handler's surface is wound up in deferred mode
- **WHEN** the incoming turn's trigger type is any other value
- **THEN** the streaming handler's surface is wound up immediately as before

#### Scenario: Button continuation of a proactive session opens immediately

- **GIVEN** a session originally created by an `autoRespond`, `threadReply`, or `channelReply` trigger
- **WHEN** a user clicks a choice, retry, or follow-up button that continues that session
- **THEN** the streaming handler's surface is wound up immediately, with the "Acknowledged, working on it..." task
- **AND** the session's stored trigger type does not cause deferral

#### Scenario: SDK thread conversation opens immediately

- **GIVEN** a plugin calls `sdk.startThreadConversation` (e.g. from the trivia "Tell me more" button), which processes the turn with trigger type `autoRespond`
- **WHEN** the turn starts
- **THEN** the streaming handler's surface is wound up immediately, with the "Acknowledged, working on it..." task
- **AND** the borrowed `autoRespond` trigger type does not cause deferral

#### Scenario: Deferral is independent of deliveryMode

- **GIVEN** a proactive turn whose resolved session has `deliveryMode: "invisible"`
- **WHEN** the turn starts
- **THEN** the silent handler is selected (deferral does not apply — there is no progress surface to defer)

#### Scenario: A handler installed mid-run receives subsequent events

- **GIVEN** a turn that started with the silent handler
- **WHEN** `setDelivery(streaming)` runs mid-turn and a later tool event is emitted
- **THEN** the new streaming handler receives that event and reflects it on its card
- **AND** events emitted before the switch are not retroactively shown

#### Scenario: A mid-run switch into streaming opens immediately

- **GIVEN** a proactive turn running with the silent handler
- **WHEN** `setDelivery(streaming)` runs mid-turn
- **THEN** the new streaming surface opens immediately rather than deferring
- **AND** the switch is an explicit request for a visible surface, so the commit predicate does not gate it

#### Scenario: setDelivery tears down the old surface before opening the new one

- **GIVEN** a turn running with the streaming handler whose card is live
- **WHEN** `setDelivery(silent)` runs
- **THEN** the streaming card is torn down (windDown) and the silent handler is wound up
- **AND** the final answer for the turn is delivered silently

#### Scenario: Switching away from an uncommitted deferred surface leaves no trace

- **GIVEN** a proactive turn whose deferred streaming surface has not committed
- **WHEN** `setDelivery(silent)` runs
- **THEN** the teardown posts nothing and deletes nothing
- **AND** the silent handler delivers the turn
