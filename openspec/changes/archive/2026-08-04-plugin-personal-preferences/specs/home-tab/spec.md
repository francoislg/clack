## MODIFIED Requirements

### Requirement: Settings Modal
The system SHALL provide a modal for users to manage their personal preferences. The settings modal shows the reaction delivery preference instead of the DM opt-out toggle. When enabled plugins have registered personal preferences, the modal SHALL additionally render a section per such plugin below the core preference fields, and on submit SHALL persist both the core fields and the plugin-contributed fields in a single save.

#### Scenario: Open settings modal
- **WHEN** a user opens the settings modal
- **THEN** the modal shows a "Reaction delivery" radio button group
- **AND** options are: "Direct Message" ("Get a private DM thread to refine before sharing.") and "Thread" ("Answer posted directly in the channel thread.")
- **AND** pre-selects the user's current `reactionDelivery` preference (default: "dm")

#### Scenario: Plugin preference sections rendered
- **WHEN** a user opens the settings modal
- **AND** one or more enabled plugins have registered personal preferences
- **THEN** the modal shows a section per such plugin below the core preference fields
- **AND** each section renders a control per declared field, pre-selecting the user's stored value or the field default
- **AND** plugin field labels are localized in the user's language

#### Scenario: No plugin sections when none registered
- **WHEN** a user opens the settings modal
- **AND** no enabled plugin has registered personal preferences
- **THEN** the modal shows only the core preference fields, identical to before

#### Scenario: Settings always shown
- **WHEN** a user views the Home Tab
- **THEN** the Settings section is always shown (not conditional on config)
- **AND** the settings button opens the modal regardless of any config value

#### Scenario: Save preferences
- **WHEN** user submits the Settings modal
- **THEN** the system persists the updated core preferences via user preferences storage
- **AND** persists any plugin-contributed preference values into the user-preferences `plugins` fold in the same save
- **AND** confirms the change (modal closes successfully)

#### Scenario: Save failure fails soft
- **WHEN** the Settings modal submit encounters a persistence error (store write failure)
- **THEN** the error is logged and the submit handler does not throw
- **AND** stored preferences are not left partially written or corrupted
