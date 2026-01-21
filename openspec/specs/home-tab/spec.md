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

#### Scenario: Show repository status
- **WHEN** building the status section
- **THEN** list all configured repositories
- **AND** show their names and descriptions

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

