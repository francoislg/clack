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
The system SHALL allow users to choose how reaction-triggered answers are delivered: via DM or directly in the channel thread.

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

### Requirement: Plugin Preferences Fold

The persisted `UserPreferences` object SHALL support an optional `plugins` fold: a record keyed by plugin name whose values are arbitrary JSON objects (each plugin's user-chosen preference slice). The fold lives alongside the core preference fields in `data/state/user-preferences.json` and is written and read as part of the same store. Writing a plugin's slice SHALL merge into (not replace) that user's existing slice for that plugin, and SHALL leave core fields and other plugins' slices untouched. This fold holds user-chosen, modal-surfaced preferences and is distinct from the `sdk.users.data` user-registry namespace, which remains bot-managed extension state.

#### Scenario: Plugin slice stored per user per plugin

- **WHEN** a plugin's preference values are saved for a user
- **THEN** they are stored under `plugins.<plugin>` in that user's preferences entry
- **AND** other users' entries and other plugins' slices are unaffected

#### Scenario: Merge preserves untouched keys

- **WHEN** a plugin merges a partial slice for a user who already has a slice for that plugin
- **THEN** keys not present in the partial retain their previous values
- **AND** core preference fields (e.g. `reactionDelivery`) are unchanged

### Requirement: User-preferences loading is schema-driven

`userPreferences.ts` SHALL parse the preferences map against a zod schema (`Record<userId, Partial<UserPreferences>>`) instead of a bare `JSON.parse` + type assertion. The deprecated `dmOptOut` field SHALL be accepted (`.optional()`) for backward compatibility but not surfaced into the runtime type. The schema SHALL also accept an optional `plugins` fold (`Record<pluginName, JsonObject>`) parsed permissively: an unknown or malformed individual plugin slice SHALL be preserved or fall back to an empty slice without discarding the rest of the user's preferences. On whole-file parse failure it SHALL return `{}` and per-key defaults SHALL apply on read, exactly as today (log + fallback, never throw).

#### Scenario: Deprecated dmOptOut is accepted, not surfaced

- **WHEN** a stored preferences file still contains `dmOptOut`
- **THEN** the file parses successfully and `dmOptOut` does not appear in the runtime preferences (other fields read with their current defaults)

#### Scenario: Corrupt preferences degrade to empty

- **WHEN** the preferences file is malformed or fails the schema
- **THEN** the loader returns `{}` and reads fall back to `DEFAULT_PREFERENCES`, exactly as today

#### Scenario: Plugins fold parsed permissively

- **WHEN** a stored preferences entry contains a `plugins` fold
- **THEN** the fold is retained on the parsed entry
- **AND** a malformed individual plugin slice does not discard the user's core preferences or other plugins' slices

### Requirement: Investigation requester-tag preference

The system SHALL persist a per-user boolean preference controlling whether the user is tagged (pinged) when they start an investigation. The preference SHALL default to OFF (no ping). When OFF, the investigation's main-surface parent message renders the requester as a plain-text display name; when ON, it renders a real Slack mention that pings the requester. The preference SHALL be settable from the Home Tab Settings modal alongside the existing delivery and notify preferences.

#### Scenario: Default is off

- **WHEN** a user has no investigation requester-tag preference set
- **THEN** the system treats it as OFF (the requester is not pinged)

#### Scenario: Value persisted and read

- **WHEN** a user sets the investigation requester-tag preference to ON
- **THEN** the value is persisted in `data/state/user-preferences.json`
- **AND** subsequent investigations started by that user render the requester as a real mention

#### Scenario: Settable from the Settings modal

- **WHEN** a user opens the Home Tab Settings modal
- **THEN** a control for the investigation requester-tag preference is present with its current value preselected
- **AND** saving updates the persisted preference

### Requirement: Investigation breadcrumb visibility preference

The system SHALL persist a per-user preference controlling whether starting an investigation posts a breadcrumb reply in the origin thread. The value SHALL be one of `"silent"` or `"explicit"` and SHALL default to `"silent"`. When `"silent"`, the bootstrap posts no origin-thread breadcrumb; when `"explicit"`, it posts exactly one breadcrumb linking the main surface. The preference SHALL be settable from the Home Tab Settings modal.

#### Scenario: Default is silent

- **WHEN** a user has no investigation breadcrumb-visibility preference set
- **THEN** the system treats it as `"silent"` and starting an investigation posts no origin-thread breadcrumb

#### Scenario: Explicit posts a breadcrumb

- **WHEN** a user's breadcrumb-visibility preference is `"explicit"` and they start an investigation
- **THEN** exactly one breadcrumb reply is posted in the origin thread

#### Scenario: Settable from the Settings modal

- **WHEN** a user opens the Home Tab Settings modal
- **THEN** a control for the investigation breadcrumb-visibility preference is present with its current value preselected
- **AND** saving updates the persisted preference
