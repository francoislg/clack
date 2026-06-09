# thread-delivery-mode Specification

## Purpose

Persist a per-thread delivery mode so that engaged sessions can suppress the live streaming UX (thinking / tool-progress card) and deliver replies directly. This lets casual or low-stakes threads run silently while work threads keep the streamer, switchable mid-conversation.

## Requirements

### Requirement: Per-Thread Delivery Mode

The system SHALL persist a per-thread delivery mode on `SessionContext` named `deliveryMode`, with values `"streamer"` and `"invisible"`. An absent value SHALL read as `"streamer"`.

At the start of every turn that resolves an existing session, the system SHALL run that turn with the streaming UX suppressed (`silentThinking`) when the resolved session's `deliveryMode` is `"invisible"`, and with the normal `SlackStreamer` (live thinking / tool-progress card) when it is `"streamer"`. A trigger that already requests `silentThinking` (e.g. cron) SHALL remain silent regardless of `deliveryMode`.

This read SHALL happen centrally so that every path reusing an engaged session (thread auto-respond, and any future engaged-session reuse) honors the mode without per-handler wiring.

#### Scenario: Invisible thread suppresses the streamer on a reply

- **GIVEN** an engaged session for `(C1, T)` with `deliveryMode: "invisible"`
- **WHEN** a human posts a reply under `T` that passes the auto-respond gate
- **THEN** the answer turn runs with `silentThinking` (no `SlackStreamer` is created)
- **AND** the reply is delivered directly, with no live thinking / tool-progress card

#### Scenario: Streamer thread is unchanged

- **GIVEN** an engaged session for `(C1, T)` with `deliveryMode` absent or `"streamer"`
- **WHEN** a human reply triggers an answer turn
- **THEN** the turn creates a `SlackStreamer` and shows the live card, exactly as before this change

#### Scenario: New non-engaged sessions default to streamer

- **WHEN** a fresh mention or DM creates a session with no `deliveryMode`
- **THEN** the turn shows the live streamer card (default `"streamer"` behavior is preserved)

### Requirement: Seeding Delivery Mode On Engagement

The `post_to` action and each `deliver_to` entry SHALL accept an optional `default_delivery_mode` field (`"streamer" | "invisible"`), sitting beside `attention_level`. When a non-`off` attention level seeds an engaged session on the destination thread, the system SHALL also seed `deliveryMode` from `default_delivery_mode` (when provided) onto that session.

When `default_delivery_mode` is omitted, the seeded session SHALL carry no explicit mode (reads as `"streamer"`).

#### Scenario: deliver_to seeds an invisible thread

- **GIVEN** a channelless run delivering one `deliver_to` entry with `attention_level: "high"` and `default_delivery_mode: "invisible"`
- **WHEN** the entry posts and seeds the destination thread's engaged session
- **THEN** that session is written with `deliveryMode: "invisible"`
- **AND** a later human reply in the thread runs silently

#### Scenario: post_to seeds an invisible thread

- **GIVEN** an auto-executed `post_to` action with `attention_level: "high"` and `default_delivery_mode: "invisible"`
- **WHEN** the cross-post seeds the destination thread's engaged session
- **THEN** that session is written with `deliveryMode: "invisible"`

#### Scenario: Omitted mode seeds nothing

- **GIVEN** a `deliver_to` entry with `attention_level: "high"` and no `default_delivery_mode`
- **THEN** the seeded session has no explicit `deliveryMode` and its replies stream normally

### Requirement: Switching Delivery Mode Mid-Conversation

The `submit_response` tool SHALL expose a top-level `default_delivery_mode` field (`"streamer" | "invisible"`) wherever the `attention_level` dial is available (engaged-thread contexts: mentions, reactions, auto-respond, thread-reply). When present, the system SHALL persist it as the resolved session's `deliveryMode`.

A persisted mode change SHALL take effect on the **next** turn for that thread, not the current one — the current turn's streaming UX is fixed before Claude runs. The system SHALL persist the change on a successful turn and on a skipped turn (mirroring `attention_level`), and SHALL NOT persist it when delivery fails.

#### Scenario: Casual thread switched to streamer for work

- **GIVEN** an engaged session with `deliveryMode: "invisible"`
- **WHEN** Claude answers a reply and sets `default_delivery_mode: "streamer"` on its `submit_response`
- **THEN** the session is updated to `deliveryMode: "streamer"`
- **AND** that answer turn was still delivered silently (the switch did not retroactively show a card)
- **AND** the next reply in the thread shows the live streamer card

#### Scenario: Switch on a skip turn

- **GIVEN** an engaged session with `deliveryMode: "streamer"`
- **WHEN** Claude declines with `skip_response: true` and sets `default_delivery_mode: "invisible"`
- **THEN** the session is updated to `deliveryMode: "invisible"` and the next reply runs silently

### Requirement: Casual-Talk Defaults To Invisible

The casual-talk cron prompt SHALL instruct Claude to set `default_delivery_mode: "invisible"` on its single `deliver_to` entry, so casual chatter threads are delivered without the streamer on both the opener (already silent via cron) and every seeded follow-up. This SHALL require no new configuration; it is the default behavior of the casual-talk plugin.

#### Scenario: Casual chatter follow-ups are silent

- **GIVEN** the casual-talk cron fires and posts an opener with `attention_level: "high"` and `default_delivery_mode: "invisible"`
- **WHEN** a human replies to the casual message
- **THEN** Clack's reply is delivered with no live thinking / tool-progress card
