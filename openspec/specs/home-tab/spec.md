# home-tab Specification

## Purpose
TBD - created by archiving change add-user-roles. Update Purpose after archive.
## Requirements
### Requirement: Home Tab Event Handling

The system SHALL respond to Slack Home tab open events.

#### Scenario: Register home tab handler
- **WHEN** the Slack app initializes
- **THEN** register a handler for `app_home_opened` events

#### Scenario: Update home view on open
- **GIVEN** a user opens the bot's Home tab
- **WHEN** the `app_home_opened` event fires
- **THEN** the system builds a view based on user's role
- **AND** publishes the view via `views.publish`

### Requirement: Status Section

The system SHALL display bot status information to all users.

#### Scenario: Show repository status filtered by role
- **WHEN** building the status section
- **THEN** list only repositories the current user has read access to
- **AND** show their names and descriptions

#### Scenario: Show access tags for dev+ users
- **GIVEN** the current user has the dev role or higher
- **WHEN** displaying a repository in the status section
- **THEN** show access level tags below each repo (e.g., `read: all · write: dev+`)
- **AND** for read-only repos (no write access defined), show `read-only`

#### Scenario: Hide access tags for members
- **GIVEN** the current user has the member role
- **WHEN** displaying repositories in the status section
- **THEN** show only repo names and descriptions without access tags

#### Scenario: Show MCP server status
- **GIVEN** MCP servers are configured
- **WHEN** building the status section
- **THEN** list connected MCP servers
- **AND** indicate connection status for each

#### Scenario: No MCP servers configured
- **GIVEN** no MCP servers are configured
- **WHEN** building the status section
- **THEN** show "No MCP servers configured" or omit the section

### Requirement: Help Section

The system SHALL display help information to all users.

#### Scenario: Show usage instructions
- **WHEN** building the help section
- **THEN** display how to trigger the bot
- **AND** list available trigger methods (reactions, DMs, mentions)
- **AND** indicate which methods are enabled

### Requirement: Role Badge Display

The system SHALL show users their assigned role.

#### Scenario: Show role for admin/dev/owner
- **GIVEN** the user has a role (owner, admin, or dev)
- **WHEN** building the home view
- **THEN** display a role badge at the top (e.g., "Your Role: Admin")

#### Scenario: Hide role for regular members
- **GIVEN** the user has no assigned role
- **WHEN** building the home view
- **THEN** do not display any role badge

### Requirement: Ownership Claim UI

The system SHALL display an ownership claim option when appropriate.

#### Scenario: Show claim button (unclaimed)
- **GIVEN** no owner exists
- **WHEN** any user views the Home tab
- **THEN** display a "Claim Ownership" button

#### Scenario: Show claim button (disabled owner)
- **GIVEN** an owner exists but is disabled
- **AND** the current user is an admin
- **WHEN** admin views the Home tab
- **THEN** display a "Claim Ownership" button
- **AND** show a message explaining the owner is inactive

#### Scenario: Handle claim button click
- **WHEN** user clicks "Claim Ownership"
- **THEN** set the user as owner via roles system
- **AND** refresh the Home tab view

### Requirement: Role Management Section

The system SHALL display role management controls to admins and owner.

#### Scenario: Hide from non-admins
- **GIVEN** the user is not an admin or owner
- **WHEN** building the home view
- **THEN** do not include the role management section

#### Scenario: Show current roles
- **GIVEN** the user is an admin or owner
- **WHEN** building the role management section
- **THEN** display the current owner
- **AND** list all admins
- **AND** list all devs

#### Scenario: Add admin button
- **GIVEN** the user is an admin or owner
- **WHEN** viewing role management
- **THEN** display an "Add Admin" button
- **AND** clicking opens a user selector modal

#### Scenario: Remove admin button
- **GIVEN** the user is an admin or owner
- **AND** there are admins listed (excluding owner)
- **WHEN** viewing role management
- **THEN** display remove buttons next to each admin

#### Scenario: Add dev button
- **GIVEN** the user is an admin or owner
- **WHEN** viewing role management
- **THEN** display an "Add Dev" button
- **AND** clicking opens a user selector modal

#### Scenario: Remove dev button
- **GIVEN** the user is an admin or owner
- **AND** there are devs listed
- **WHEN** viewing role management
- **THEN** display remove buttons next to each dev

### Requirement: Transfer Ownership UI

The system SHALL allow the owner to transfer ownership.

#### Scenario: Show transfer button to owner
- **GIVEN** the current user is the owner
- **WHEN** viewing role management
- **THEN** display a "Transfer Ownership" button

#### Scenario: Hide transfer from non-owners
- **GIVEN** the current user is an admin but not owner
- **WHEN** viewing role management
- **THEN** do not display the transfer button

#### Scenario: Handle transfer button click
- **WHEN** owner clicks "Transfer Ownership"
- **THEN** open a modal with user selector
- **AND** allow selecting a target user

#### Scenario: Execute transfer
- **WHEN** owner confirms transfer in modal
- **THEN** validate target is not disabled
- **AND** transfer ownership via roles system
- **AND** refresh the Home tab view

### Requirement: User Selection Modals

The system SHALL provide modals for selecting users.

#### Scenario: Open add admin modal
- **WHEN** admin clicks "Add Admin"
- **THEN** open a modal with user selector
- **AND** filter out users already admins

#### Scenario: Open add dev modal
- **WHEN** admin clicks "Add Dev"
- **THEN** open a modal with user selector
- **AND** filter out users already devs

#### Scenario: Handle modal submission
- **WHEN** user submits the selection modal
- **THEN** extract selected user IDs
- **AND** perform the appropriate role action
- **AND** refresh the Home tab

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

### Requirement: Migration Status Banner

The system SHALL display a migration status banner on the Home tab when migrations are pending or failed.

#### Scenario: Show error banner on failed migration
- **WHEN** a migration has failed (e.g., admin DM timeout, Claude execution error)
- **AND** any user opens the Home tab
- **THEN** display a warning banner at the top of the Home tab describing the migration failure
- **AND** include the migration name and error summary

#### Scenario: Show error banner to admin with action guidance
- **WHEN** a migration has failed
- **AND** an admin or owner opens the Home tab
- **THEN** display the warning banner with guidance on how to resolve the issue
- **AND** suggest contacting the Clack operator or checking logs

#### Scenario: No banner when migrations are healthy
- **WHEN** no migrations are pending or failed
- **AND** a user opens the Home tab
- **THEN** do not display any migration-related banner
