## MODIFIED Requirements

### Requirement: Settings Modal
The settings modal is updated to show the reaction delivery preference instead of the DM opt-out toggle.

#### Scenario: Open settings modal (UPDATED)
- **WHEN** a user opens the settings modal
- **THEN** the modal shows a "Reaction delivery" radio button group
- **AND** options are: "Direct Message" ("Get a private DM thread to refine before sharing.") and "Thread" ("Answer posted directly in the channel thread.")
- **AND** pre-selects the user's current `reactionDelivery` preference (default: "dm")

#### Scenario: Settings always shown (UPDATED)
- **WHEN** a user views the Home Tab
- **THEN** the Settings section is always shown (not conditional on config)
- **AND** the settings button opens the modal regardless of any config value

#### Scenario: DM toggle hidden when ephemeral mode
**Removed** — there is no ephemeral mode. The settings modal is always available.
