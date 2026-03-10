# user-preferences Specification

## Purpose
Persist and manage per-user preferences to support individual configuration of response delivery and other user-facing settings.

## Requirements

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

### Requirement: Reaction Delivery Preference
Allow users to choose how reaction-triggered answers are delivered: via DM or directly in the channel thread.

#### Scenario: Preference values
- **WHEN** a user sets their reaction delivery preference
- **THEN** the value SHALL be one of `"dm"` or `"thread"`

#### Scenario: Default preference
- **WHEN** a user has no `reactionDelivery` preference set
- **THEN** the system defaults to `"dm"`

#### Scenario: DM delivery selected
- **WHEN** a user's `reactionDelivery` is `"dm"`
- **THEN** reaction-triggered answers are delivered in a private DM thread

#### Scenario: Thread delivery selected
- **WHEN** a user's `reactionDelivery` is `"thread"`
- **THEN** reaction-triggered answers are posted visibly in the channel thread where the reaction was added

#### Scenario: Preference respected immediately
- **WHEN** a user changes their `reactionDelivery` preference
- **THEN** the next reaction-triggered answer uses the new preference
