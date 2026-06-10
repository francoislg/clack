## MODIFIED Requirements

### Requirement: Per-Thread Delivery Mode

The system SHALL persist a per-thread delivery mode on `SessionContext` named `deliveryMode`, with values `"streamer"` and `"invisible"`. An absent value SHALL read as `"streamer"`. The mode SHALL govern ONLY whether a live progress surface (thinking / tool-progress card) is shown for the turn; it SHALL NOT determine where the primary response lands. The landing target (in-thread vs. top-level) SHALL be derived from session/turn context independently of `deliveryMode`, so a reply to an engaged thread lands in that thread under either mode.

At the start of every turn that resolves an existing session, the system SHALL select the turn's initial delivery handler from the resolved session's `deliveryMode`: `"invisible"` selects the silent handler (no live thinking / tool-progress card), and `"streamer"` (or absent) selects the streaming handler (the live `SlackStreamer` card). A trigger that already requests `silentThinking` (e.g. cron) SHALL select the silent handler regardless of `deliveryMode`.

This selection SHALL happen at one central point so that every path reusing an engaged session (thread auto-respond, and any future engaged-session reuse) honors the mode without per-call-site wiring.

#### Scenario: Invisible thread suppresses the streamer on a reply but stays in-thread

- **GIVEN** an engaged session for `(C1, T)` with `deliveryMode: "invisible"`
- **WHEN** a human posts a reply under `T` that passes the auto-respond gate
- **THEN** the silent delivery handler is selected (no live card is opened)
- **AND** the reply is delivered into thread `T` (posted with `thread_ts: T`), with no live thinking / tool-progress card

#### Scenario: Streamer thread is unchanged

- **GIVEN** an engaged session for `(C1, T)` with `deliveryMode` absent or `"streamer"`
- **WHEN** a human reply triggers an answer turn
- **THEN** the streaming handler is selected and shows the live `SlackStreamer` card, exactly as before
- **AND** the reply lands in thread `T`

#### Scenario: New non-engaged sessions default to streamer

- **WHEN** a fresh mention or DM creates a session with no `deliveryMode`
- **THEN** the streaming handler is selected (default `"streamer"` behavior is preserved)
