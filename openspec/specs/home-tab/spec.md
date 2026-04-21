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
The system SHALL provide a modal for users to manage their personal preferences. The settings modal shows the reaction delivery preference instead of the DM opt-out toggle.

#### Scenario: Open settings modal
- **WHEN** a user opens the settings modal
- **THEN** the modal shows a "Reaction delivery" radio button group
- **AND** options are: "Direct Message" ("Get a private DM thread to refine before sharing.") and "Thread" ("Answer posted directly in the channel thread.")
- **AND** pre-selects the user's current `reactionDelivery` preference (default: "dm")

#### Scenario: Settings always shown
- **WHEN** a user views the Home Tab
- **THEN** the Settings section is always shown (not conditional on config)
- **AND** the settings button opens the modal regardless of any config value

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

### Requirement: Configuration Section Display

The system SHALL display a summary Configuration section on the Home tab for users with config edit permissions, showing one line per role directory.

#### Scenario: Show role directories with file counts
- **GIVEN** the user has config edit permissions (admin or owner)
- **WHEN** building the Configuration section
- **THEN** display one line per role directory (`user/`, `dev/`, `admin/`, `owner/`)
- **AND** each line shows the count of default files and custom files (e.g., `user/ — 5 default, 2 custom`)
- **AND** directories with no files in either tier are omitted

#### Scenario: Show repo instruction files
- **GIVEN** repositories are configured
- **WHEN** building the Configuration section
- **THEN** display one line per repository showing its instruction files and their status
- **AND** repo lines appear after role directory lines

#### Scenario: Show chat hint
- **GIVEN** the user views the Configuration section
- **WHEN** the directory summary has been rendered
- **THEN** display a context hint directing the user to chat with Clack to view or update configuration files

#### Scenario: Show admin config tools hint for admin users
- **WHEN** building the Home Tab for a user with admin or owner role
- **THEN** display a context block in the Configuration section noting that core config files (config.json, mcp.json, .env, tool mappings) can be edited by asking in a conversation

#### Scenario: Hide from non-editors
- **GIVEN** the user does not have config edit permissions
- **WHEN** building the home view
- **THEN** do not include the Configuration section

### Requirement: Auto-Respond Section

The system SHALL display an Auto-Respond management section on the Home Tab for admin and owner users.

#### Scenario: Show section to admins
- **GIVEN** the current user is an admin or owner
- **WHEN** building the home view
- **THEN** display the Auto-Respond section with current rules and an "Add Rule" button

#### Scenario: Hide section from non-admins
- **GIVEN** the current user is a dev or member
- **WHEN** building the home view
- **THEN** do NOT include the Auto-Respond section

#### Scenario: Display rules list
- **WHEN** auto-respond rules exist
- **THEN** display each rule showing its channels as `<#channelId>` mrkdwn references and user filters as `<@userId>` mrkdwn references (Slack resolves these to display names automatically)
- **AND** each rule has an [Edit] accessory button
- **AND** disabled rules are visually distinguished (e.g., "paused" label)

#### Scenario: Empty state
- **WHEN** no auto-respond rules exist
- **THEN** display a message indicating no rules are configured
- **AND** show the "Add Rule" button

### Requirement: Add Rule Modal

The system SHALL provide a modal for creating auto-respond rules.

#### Scenario: Open add rule modal
- **WHEN** an admin clicks "Add Rule"
- **THEN** open a modal with:
  - A `multi_conversations_select` element with filter `{ include: ["public", "private"], exclude_bot_users: true }` for choosing channels
  - A `multi_users_select` element for optional user/bot filtering
  - A keywords text input (comma-separated, optional)
  - An extra context multiline text input (optional)
  - A context note reminding the admin that the bot must be a member of selected channels

#### Scenario: Submit add rule modal
- **WHEN** an admin submits the add rule modal with valid channels
- **THEN** the system creates a new enabled rule with the selected channels, user filters, keywords, and extra context
- **AND** refreshes the Home Tab

### Requirement: Edit Rule Modal

The system SHALL provide a modal for editing existing auto-respond rules.

#### Scenario: Open edit rule modal
- **WHEN** an admin clicks "Edit" on a rule
- **THEN** open a modal pre-populated with the rule's current channels, user filters, keywords, and extra context
- **AND** include Enable/Disable and Delete actions at the bottom of the modal

#### Scenario: Submit edit rule modal
- **WHEN** an admin submits the edit rule modal
- **THEN** the system updates the rule
- **AND** refreshes the Home Tab

### Requirement: Toggle and Delete Rule Actions

The system SHALL support toggling and deleting rules from the edit modal.

#### Scenario: Toggle rule enabled state
- **WHEN** an admin clicks the enable/disable button in the edit modal
- **THEN** the system toggles the rule's enabled state
- **AND** refreshes the modal and Home Tab

#### Scenario: Delete rule
- **WHEN** an admin clicks "Delete" in the edit modal and confirms
- **THEN** the system removes the rule
- **AND** closes the modal and refreshes the Home Tab

### Requirement: Scheduled Messages Section

The system SHALL display a Scheduled Messages section on the Home Tab with role-based visibility and management controls. The job's `skipConditions` is NOT rendered inline on the Home Tab row — admins and creators edit the field through the scheduled-message edit modal, which pre-fills the stored value.

#### Scenario: Admin sees all scheduled messages
- **GIVEN** the current user is an admin or owner
- **WHEN** building the home view
- **THEN** display the Scheduled Messages section with all cron jobs
- **AND** each job shows: target channel, schedule description (human-readable), creator, last run status
- **AND** each job has [Disable]/[Enable] and [Delete] buttons

#### Scenario: Non-admin sees own scheduled messages
- **GIVEN** the current user is a dev or member
- **WHEN** building the home view
- **AND** the user has created cron jobs
- **THEN** display the Scheduled Messages section with only their own jobs
- **AND** each job has [Disable]/[Enable] and [Delete] buttons

#### Scenario: No scheduled messages
- **GIVEN** the user has no visible scheduled messages (own or all depending on role)
- **WHEN** building the home view
- **THEN** do not display the Scheduled Messages section

#### Scenario: Toggle scheduled message from Home Tab
- **WHEN** an admin clicks [Enable] or [Disable] on a scheduled message
- **THEN** the system toggles the job's enabled state
- **AND** refreshes the Home Tab view

#### Scenario: Delete scheduled message from Home Tab
- **WHEN** an admin clicks [Delete] on a scheduled message
- **THEN** the system deletes the cron job
- **AND** refreshes the Home Tab view

#### Scenario: Non-admin manages own messages
- **WHEN** a non-admin clicks [Enable]/[Disable] or [Delete] on their own scheduled message
- **THEN** the system performs the action
- **AND** refreshes the Home Tab view

#### Scenario: Job display format
- **WHEN** rendering a cron job in the Home Tab
- **THEN** display the job as: channel name, human-readable schedule (e.g., "Every day at 9:00 AM ET"), creator mention
- **AND** if the job has `lastRunStatus: "error"`, show a warning indicator
- **AND** if the job has `lastRunStatus: "skipped"`, show a distinct "skipped" indicator (neutral, not a warning)
- **AND** if the job is disabled, show a "paused" label
- **AND** if the job is `oneShot`, show a "one-time" label
- **AND** `skipConditions` is NOT rendered inline on the row — it is only visible inside the edit modal

#### Scenario: Edit modal exposes skipConditions
- **WHEN** an admin, an owner, or the job's creator opens the scheduled-message edit modal (matching the existing enable/disable/delete permission gate)
- **THEN** the modal includes a multi-line input for `skipConditions` pre-filled with the stored value (empty when unset)
- **AND** submitting the modal with a non-empty value updates the job's `skipConditions`
- **AND** submitting the modal with an empty value clears the job's `skipConditions`
- **AND** the Home Tab refreshes to reflect the change

#### Scenario: Non-admin non-creator cannot edit
- **WHEN** a non-admin user who did not create the job attempts to edit `skipConditions` on it
- **THEN** the edit action SHALL be rejected (the UI does not expose the edit control for such users, and any direct submission is rejected server-side)
