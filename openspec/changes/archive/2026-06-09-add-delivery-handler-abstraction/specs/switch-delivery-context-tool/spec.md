## ADDED Requirements

### Requirement: switch_delivery_context Tool

The system SHALL expose an MCP tool `switch_delivery_context` that takes a delivery mode (`"streamer" | "invisible"`) and switches the in-flight delivery for the current turn immediately. The tool SHALL be available only on interactive triggers (mentions, reactions, direct messages, auto-respond, thread replies) and SHALL be absent in channelless cron and worker contexts, where there is no live streaming surface to switch.

When invoked, the tool SHALL call a `deliveryControl.switchTo(mode)` handle provided by the delivery orchestrator — it SHALL NOT manipulate any streamer directly. `switchTo(mode)` SHALL perform `setDelivery(handlerFor(mode))` AND persist the new mode as the session's `deliveryMode` so subsequent turns follow it. The tool SHALL return a `textResult` so Claude continues the turn (it is not a terminator).

`switchTo` SHALL be idempotent: switching to the mode already active SHALL be a no-op (no surface teardown/recreation, no redundant persistence write).

#### Scenario: Switching invisible→streamer surfaces the card on this turn

- **GIVEN** an interactive turn that started with `deliveryMode: "invisible"` (no card)
- **WHEN** Claude calls `switch_delivery_context("streamer")` mid-turn
- **THEN** a streaming card is wound up immediately and captures subsequent tool events
- **AND** the session's `deliveryMode` is persisted as `"streamer"`
- **AND** the turn continues (the tool returned a non-terminal result)

#### Scenario: Switching streamer→invisible removes the card and goes silent

- **GIVEN** an interactive turn that started with the streaming card live
- **WHEN** Claude calls `switch_delivery_context("invisible")`
- **THEN** the card is torn down and the remainder of the turn delivers silently
- **AND** the session's `deliveryMode` is persisted as `"invisible"`

#### Scenario: Switching to the active mode is a no-op

- **GIVEN** an interactive turn currently in streaming mode
- **WHEN** Claude calls `switch_delivery_context("streamer")`
- **THEN** no surface is torn down or recreated and nothing is re-persisted

#### Scenario: Tool is absent in non-interactive contexts

- **GIVEN** a channelless cron run or a worker-mode turn
- **WHEN** the tool schema is assembled
- **THEN** `switch_delivery_context` is not offered
