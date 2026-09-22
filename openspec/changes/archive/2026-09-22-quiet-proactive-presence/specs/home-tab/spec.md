## MODIFIED Requirements

### Requirement: Add Rule Modal

The system SHALL provide a modal for creating auto-respond rules.

#### Scenario: Open add rule modal
- **WHEN** an admin clicks "Add Rule"
- **THEN** open a modal with:
  - A `multi_conversations_select` element with filter `{ include: ["public", "private"], exclude_bot_users: true }` for choosing channels
  - A `multi_users_select` element for optional user/bot filtering
  - A keywords text input (comma-separated, optional)
  - An extra context multiline text input (optional)
  - An attention-level `static_select` (optional) offering the four settable rungs plus a default choice
  - A context note reminding the admin that the bot must be a member of selected channels

#### Scenario: Submit add rule modal
- **WHEN** an admin submits the add rule modal with valid channels
- **THEN** the system creates a new enabled rule with the selected channels, user filters, keywords, extra context, and attention level
- **AND** refreshes the Home Tab

#### Scenario: Add rule save fails
- **WHEN** an admin submits the add rule modal and saving the rule fails
- **THEN** the modal stays open with a localized save-failure error on the channels field
- **AND** no rule is created

### Requirement: Edit Rule Modal

The system SHALL provide a modal for editing existing auto-respond rules.

#### Scenario: Open edit rule modal
- **WHEN** an admin clicks "Edit" on a rule
- **THEN** open a modal pre-populated with the rule's current channels, user filters, keywords, extra context, and attention level
- **AND** include Enable/Disable and Delete actions at the bottom of the modal

#### Scenario: Submit edit rule modal
- **WHEN** an admin submits the edit rule modal
- **THEN** the system updates the rule, including its attention level
- **AND** refreshes the Home Tab

#### Scenario: Edit rule save fails
- **WHEN** an admin submits the edit rule modal and saving the rule fails
- **THEN** the modal stays open with a localized save-failure error on the channels field
