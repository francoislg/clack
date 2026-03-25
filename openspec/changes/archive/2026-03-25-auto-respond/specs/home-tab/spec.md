## ADDED Requirements

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
- **AND** each rule has [Edit], [Enable/Disable], and [Delete] buttons
- **AND** disabled rules are visually distinguished (e.g., strikethrough or "paused" label)

#### Scenario: Empty state
- **WHEN** no auto-respond rules exist
- **THEN** display a message indicating no rules are configured
- **AND** show the "Add Rule" button

### Requirement: Add Rule Modal

The system SHALL provide a modal for creating auto-respond rules.

#### Scenario: Open add rule modal
- **WHEN** an admin clicks "Add Rule"
- **THEN** open a modal with:
  - A `multi_conversations_select` element with filter `{ include: ["public", "private"], exclude_bot_users: true }` for choosing channels (supports both public and private channels)
  - A `multi_users_select` element for optional user/bot filtering (includes both human users and bot users)
  - The channel field is required (placed in an `input` block without `optional: true`)
  - The user filter field is optional (placed in an `input` block with `optional: true`, empty means "all messages in channel")
  - A context note reminding the admin that the bot must be a member of selected channels to receive messages

#### Scenario: Submit add rule modal
- **WHEN** an admin submits the add rule modal with valid channels
- **THEN** the system creates a new enabled rule with the selected channels and user filters
- **AND** refreshes the Home Tab

### Requirement: Edit Rule Modal

The system SHALL provide a modal for editing existing auto-respond rules.

#### Scenario: Open edit rule modal
- **WHEN** an admin clicks "Edit" on a rule
- **THEN** open a modal pre-populated with the rule's current channels (via `initial_conversations`) and user filters (via `initial_users`)

#### Scenario: Submit edit rule modal
- **WHEN** an admin submits the edit rule modal
- **THEN** the system updates the rule with the new channels and user filters
- **AND** refreshes the Home Tab

### Requirement: Toggle and Delete Rule Actions

The system SHALL support toggling and deleting rules from the Home Tab.

#### Scenario: Toggle rule enabled state
- **WHEN** an admin clicks the enable/disable button on a rule
- **THEN** the system toggles the rule's enabled state
- **AND** refreshes the Home Tab

#### Scenario: Delete rule
- **WHEN** an admin clicks "Delete" on a rule
- **THEN** the system removes the rule
- **AND** refreshes the Home Tab
