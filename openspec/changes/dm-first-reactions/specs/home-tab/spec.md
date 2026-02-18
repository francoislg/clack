## ADDED Requirements

### Requirement: Settings Section
The system SHALL display a Settings section on the Home tab for all users.

#### Scenario: Settings button displayed
- **WHEN** building the home view for any user
- **THEN** display a "Settings" button in the Home tab
- **AND** clicking opens a Settings modal

### Requirement: Settings Modal
The system SHALL provide a modal for users to manage their personal preferences.

#### Scenario: Open settings modal
- **WHEN** a user clicks the "Settings" button on the Home tab
- **THEN** the system opens a modal titled "Settings"
- **AND** displays the user's current preference values

#### Scenario: DM toggle visible when DM mode active
- **WHEN** `reactions.responseType` is `"directMessage"`
- **AND** the Settings modal is opened
- **THEN** display a "Response delivery" section
- **AND** show options: "Send answers in DM" (recommended) and "Use ephemeral messages instead"
- **AND** pre-select based on the user's current `dmOptOut` preference

#### Scenario: DM toggle hidden when ephemeral mode
- **WHEN** `reactions.responseType` is `"ephemeral"`
- **AND** the Settings modal is opened
- **THEN** do NOT display the "Response delivery" section
- **AND** show a message indicating no configurable settings are available (or omit the modal entirely)

#### Scenario: Save preferences
- **WHEN** user submits the Settings modal
- **THEN** the system persists the updated preferences via user preferences storage
- **AND** confirms the change (modal closes successfully)
