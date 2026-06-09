## MODIFIED Requirements

### Requirement: Per-Thread Delivery Mode

The system SHALL persist a per-thread delivery mode on `SessionContext` named `deliveryMode`, with values `"streamer"` and `"invisible"`. An absent value SHALL read as `"streamer"`.

At the start of every turn that resolves an existing session, the system SHALL select the turn's initial delivery handler from the resolved session's `deliveryMode`: `"invisible"` selects the silent handler (no live thinking / tool-progress card), and `"streamer"` (or absent) selects the streaming handler (the live `SlackStreamer` card). A trigger that already requests `silentThinking` (e.g. cron) SHALL select the silent handler regardless of `deliveryMode`.

This selection SHALL happen at one central point so that every path reusing an engaged session (thread auto-respond, and any future engaged-session reuse) honors the mode without per-call-site wiring.

#### Scenario: Invisible thread suppresses the streamer on a reply

- **GIVEN** an engaged session for `(C1, T)` with `deliveryMode: "invisible"`
- **WHEN** a human posts a reply under `T` that passes the auto-respond gate
- **THEN** the silent delivery handler is selected (no live card is opened)
- **AND** the reply is delivered directly, with no live thinking / tool-progress card

#### Scenario: Streamer thread is unchanged

- **GIVEN** an engaged session for `(C1, T)` with `deliveryMode` absent or `"streamer"`
- **WHEN** a human reply triggers an answer turn
- **THEN** the streaming handler is selected and shows the live `SlackStreamer` card, exactly as before

#### Scenario: New non-engaged sessions default to streamer

- **WHEN** a fresh mention or DM creates a session with no `deliveryMode`
- **THEN** the streaming handler is selected (default `"streamer"` behavior is preserved)

### Requirement: Switching Delivery Mode Mid-Conversation

The `submit_response` tool SHALL expose a top-level `default_delivery_mode` field (`"streamer" | "invisible"`) wherever the `attention_level` dial is available (engaged-thread contexts: mentions, reactions, auto-respond, thread-reply). When present, the system SHALL persist it as the resolved session's `deliveryMode`.

A mode change persisted via this `submit_response` field SHALL take effect on the **next** turn for that thread, not the current one — the current turn's initial handler is selected before Claude runs. The system SHALL persist the change on a successful turn and on a skipped turn (mirroring `attention_level`), and SHALL NOT persist it when delivery fails. Same-turn (in-flight) switching is provided separately by the `switch_delivery_context` tool (see the `switch-delivery-context-tool` capability); the two coexist — the `submit_response` field persists only, the tool both switches now and persists.

#### Scenario: Casual thread switched to streamer for work (next turn)

- **GIVEN** an engaged session with `deliveryMode: "invisible"`
- **WHEN** Claude answers a reply and sets `default_delivery_mode: "streamer"` on its `submit_response`
- **THEN** the session is updated to `deliveryMode: "streamer"`
- **AND** that answer turn was still delivered silently (the field did not retroactively show a card)
- **AND** the next reply in the thread shows the live streamer card

#### Scenario: Switch on a skip turn

- **GIVEN** an engaged session with `deliveryMode: "streamer"`
- **WHEN** Claude declines with `skip_response: true` and sets `default_delivery_mode: "invisible"`
- **THEN** the session is updated to `deliveryMode: "invisible"` and the next reply runs silently
