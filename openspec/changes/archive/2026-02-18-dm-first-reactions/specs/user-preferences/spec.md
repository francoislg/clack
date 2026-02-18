## ADDED Requirements

### Requirement: User Preferences Storage
The system SHALL persist per-user preferences in `data/state/user-preferences.json`.

#### Scenario: Preferences file structure
- **WHEN** user preferences are stored
- **THEN** the file contains a JSON object keyed by Slack user ID
- **AND** each value is an object with preference fields (e.g., `{ "dmOptOut": true }`)

#### Scenario: Default preferences
- **WHEN** a user has no entry in the preferences file
- **THEN** the system uses default values for all preferences
- **AND** the default for `dmOptOut` is `false` (DM mode active)

#### Scenario: Preferences loaded on demand
- **WHEN** the system needs to check a user's preferences
- **THEN** it reads from the preferences file (with caching)
- **AND** returns defaults for missing users

#### Scenario: Preferences persisted on save
- **WHEN** a user updates their preferences
- **THEN** the system writes the updated preferences to disk
- **AND** the change is immediately effective for subsequent reactions

### Requirement: DM Opt-Out Preference
The system SHALL allow users to opt out of DM-first response delivery.

#### Scenario: Opt-out respected during delivery
- **WHEN** a user has `dmOptOut: true` in their preferences
- **AND** `reactions.responseType` is `"directMessage"`
- **THEN** the system delivers responses via ephemeral messages instead of DM

#### Scenario: Opt-out irrelevant when config is ephemeral
- **WHEN** `reactions.responseType` is `"ephemeral"`
- **THEN** the system always delivers via ephemeral regardless of user preferences
- **AND** the `dmOptOut` preference has no effect
