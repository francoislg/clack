## ADDED Requirements

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
