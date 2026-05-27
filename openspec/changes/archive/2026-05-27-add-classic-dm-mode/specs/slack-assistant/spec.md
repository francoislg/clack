## MODIFIED Requirements

### Requirement: Assistant Registration

The system SHALL register a Bolt `Assistant` instance to handle all DM-based interactions via Slack's Agents & Assistants API, gated on `config.directMessages.enabled` being `true` AND `config.directMessages.dmType` being `"assistant"` (or absent — the default). When `dmType` is `"classic"`, the `Assistant` instance SHALL NOT be registered; the classic DM handler defined in the `slack-classic-dm` capability handles DMs instead.

#### Scenario: Assistant registered on startup with default dmType
- **GIVEN** `config.directMessages.enabled` is `true` AND `config.directMessages.dmType` is absent
- **WHEN** the Slack app is created
- **THEN** the system registers an `Assistant` with `threadStarted`, `userMessage`, and `threadContextChanged` handlers
- **AND** the Assistant intercepts all DM thread messages

#### Scenario: Assistant registered on startup with explicit assistant dmType
- **GIVEN** `config.directMessages.enabled` is `true` AND `config.directMessages.dmType` is `"assistant"`
- **WHEN** the Slack app is created
- **THEN** the system registers an `Assistant` with `threadStarted`, `userMessage`, and `threadContextChanged` handlers

#### Scenario: Assistant NOT registered when dmType is classic
- **GIVEN** `config.directMessages.enabled` is `true` AND `config.directMessages.dmType` is `"classic"`
- **WHEN** the Slack app is created
- **THEN** the system does NOT call `app.assistant(...)`
- **AND** classic DM handling is registered instead (see `slack-classic-dm` capability)

#### Scenario: Assistant NOT registered when DMs disabled
- **GIVEN** `config.directMessages.enabled` is `false`
- **WHEN** the Slack app is created
- **THEN** the system does NOT register an `Assistant` regardless of `dmType`
