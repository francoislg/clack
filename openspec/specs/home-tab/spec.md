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

### Requirement: Plugin Error Banner

The Home Tab `Status > Plugins` section SHALL render an error banner immediately beneath any plugin row whose `PluginLoadResult.errors` array is non-empty. Each entry in `errors[]` SHALL be rendered as a distinct visual line beneath the plugin name, prefixed with a warning indicator. When `errors[]` is empty, no banner is rendered for that plugin (the row appears with its usual healthy status).

The banner SHALL be visible to admins and owners. Non-admin home views SHALL NOT render the banner regardless of the underlying plugin state.

#### Scenario: Plugin with single error shows banner

- **GIVEN** the current user is an admin or owner
- **AND** the trivia plugin's `PluginLoadResult.errors` equals `["Trivia requires the cron scheduler."]`
- **WHEN** the Home Tab is rendered
- **THEN** the `Status > Plugins` section includes a row for `trivia`
- **AND** an error banner directly beneath that row containing the reason text
- **AND** the banner is visually distinguishable (warning icon or color)

#### Scenario: Plugin with multiple errors shows multi-line banner

- **GIVEN** the current user is an admin or owner
- **AND** a plugin's `errors` array contains two strings `["reason A", "reason B"]`
- **WHEN** the Home Tab is rendered
- **THEN** the banner beneath that plugin's row renders both reasons as separate lines in original call order

#### Scenario: Plugin with no errors shows no banner

- **GIVEN** the current user is an admin or owner
- **AND** a plugin's `errors` array is empty
- **WHEN** the Home Tab is rendered
- **THEN** the plugin row appears with no banner beneath it

#### Scenario: Non-admin does not see banner

- **GIVEN** the current user is a dev or member (not admin/owner)
- **AND** a loaded plugin has non-empty `errors`
- **WHEN** the Home Tab is rendered
- **THEN** the plugin error banner is NOT rendered
- **AND** the user's view of the Home Tab is unchanged from a successful plugin load

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

### Requirement: Skills Section in Home Tab

When `userSkills.enabled === true`, the Home Tab SHALL render a "Skills" section between the existing Configurations section and the Schedules section. The section SHALL display:
- A header "Skills" with a short description ("Org-authored skills available to Claude in every session")
- A "+ Create skill" button visible to every user permitted by `canCreateUserSkill(role)` (member+)
- One row per user skill (enabled and disabled), alphabetized by slug, showing:
  - the slug as the row title
  - the frontmatter `description` as the row body (truncated to a sensible Slack-display length)
  - an "Owner: @userId" badge (rendered as a Slack mention)
  - a "(disabled)" badge for disabled skills
  - an "Edit" button visible to viewers permitted by `canEditUserSkill(role, ownerUserId, callerUserId)`
  - a "Disable" button on enabled rows (same permission gate as Edit)
  - a "Restore" button on disabled rows (same permission gate)

When `userSkills.enabled === false`, the Skills section SHALL NOT render.

#### Scenario: Section hidden when feature disabled

- **GIVEN** `userSkills.enabled === false`
- **WHEN** any user opens the Home Tab
- **THEN** the rendered view contains no "Skills" header or block

#### Scenario: Section visible when feature enabled, even with no skills

- **GIVEN** `userSkills.enabled === true` and no user skills exist
- **WHEN** a member opens the Home Tab
- **THEN** the rendered view contains the "Skills" header
- **AND** the "+ Create skill" button is visible
- **AND** no skill rows are rendered (an empty-state message such as "No user skills yet" is shown instead)

#### Scenario: Member sees create button

- **GIVEN** `userSkills.enabled === true` and the viewer has role `member`
- **WHEN** the Home Tab is rendered
- **THEN** the "+ Create skill" button is present

#### Scenario: Owner sees Edit and Disable on their own skill

- **GIVEN** `copy-improver` is owned by U123 and is enabled
- **WHEN** U123 opens the Home Tab
- **THEN** the `copy-improver` row shows both "Edit" and "Disable" buttons

#### Scenario: Non-owner non-admin does not see Edit/Disable on someone else's skill

- **GIVEN** `copy-improver` is owned by U123 and the viewer is U999 (member, non-owner)
- **WHEN** U999 opens the Home Tab
- **THEN** the `copy-improver` row shows neither "Edit" nor "Disable" buttons

#### Scenario: Admin sees Edit and Disable on every skill

- **GIVEN** the viewer has role `admin`
- **WHEN** the Home Tab is rendered with three skills owned by different users
- **THEN** every row shows "Edit" and "Disable" (or "Restore" if disabled) buttons

#### Scenario: Disabled skill shows Restore instead of Disable

- **GIVEN** `meeting-notes` has `disabledAt` set
- **WHEN** the Home Tab is rendered for a user with edit permission on it
- **THEN** the row shows a "(disabled)" badge
- **AND** the row shows a "Restore" button (not "Disable")

#### Scenario: Skills section is alphabetized

- **GIVEN** three enabled skills `zebra`, `apple`, `mango`
- **WHEN** the Home Tab renders the Skills section
- **THEN** rows appear in order: `apple`, `mango`, `zebra`

### Requirement: Create Skill Modal

The "+ Create skill" button SHALL open a Slack modal with three inputs:
- A "Name" plain-text input (placeholder describing the slug rules, max 64 chars)
- A "When to use" plain-text input (multiline, max 1024 chars) — maps to the frontmatter `description`
- A "Body" plain-text input (multiline) — maps to the SKILL.md body

Submission SHALL validate the name client-side (slug regex) and re-validate server-side. On success, the modal SHALL close and a confirmation message SHALL be posted as an ephemeral notification to the requester. The created skill SHALL appear in the next Home Tab render.

#### Scenario: Successful create from Home Tab

- **GIVEN** a member clicks "+ Create skill"
- **AND** fills in `name: copy-improver`, valid description, and body
- **AND** submits
- **THEN** the modal closes
- **AND** `data/user-skills/copy-improver/SKILL.md` and `.meta.json` are written with `ownerUserId` set to the submitter
- **AND** an ephemeral confirmation is shown to the submitter

#### Scenario: Invalid slug surfaces inline error

- **WHEN** the user enters `name: Bad-Name` and submits
- **THEN** the modal stays open with an inline error on the Name field identifying the slug rules

#### Scenario: Slug collision surfaces inline error

- **GIVEN** `copy-improver` already exists
- **WHEN** the user submits a create modal with `name: copy-improver`
- **THEN** the modal stays open with an inline error identifying the collision

### Requirement: Edit Skill Modal

The "Edit" button SHALL open a Slack modal pre-populated with the current skill's name (read-only, disabled), description, and body. The submitter SHALL be able to change description and body but NOT name. On submit, the SKILL.md and `.meta.json` are updated atomically and `updatedAt` is refreshed. The button SHALL be available only when `canEditUserSkill(role, ownerUserId, callerUserId)` is `true`.

#### Scenario: Owner edits description and body

- **GIVEN** U123 owns `copy-improver` and opens the Edit modal
- **WHEN** they change the description and body, then submit
- **THEN** the SKILL.md is overwritten with the new content
- **AND** `.meta.json.updatedAt` is updated
- **AND** `ownerUserId` and `createdAt` are preserved
- **AND** the next Home Tab render shows the updated description

#### Scenario: Name field is read-only

- **WHEN** the Edit modal is rendered
- **THEN** the Name field is displayed but cannot be modified

#### Scenario: Submission re-checks permission

- **GIVEN** an edit modal was opened by U123 (the owner)
- **AND** between open and submit, ownership was reassigned (or the caller lost admin role)
- **WHEN** the modal is submitted
- **THEN** the handler re-evaluates `canEditUserSkill` and rejects with an inline error if it fails

### Requirement: Disable and Restore Buttons

The "Disable" button SHALL set `disabledAt` to the current timestamp in `.meta.json` after a confirmation step (either a small inline confirm card or a modal — implementation choice consistent with existing destructive Home Tab actions). The "Restore" button SHALL clear `disabledAt` without confirmation (it is non-destructive). Both SHALL be permission-gated identically to Edit.

#### Scenario: Disable confirms then applies

- **WHEN** a permitted user clicks "Disable" on `copy-improver`
- **THEN** a confirmation prompt is shown
- **WHEN** the user confirms
- **THEN** `.meta.json.disabledAt` is set
- **AND** the next Home Tab render shows the skill with a "(disabled)" badge and a "Restore" button

#### Scenario: Restore applies immediately

- **WHEN** a permitted user clicks "Restore" on a disabled skill
- **THEN** `.meta.json.disabledAt` is removed
- **AND** the next Home Tab render shows the skill in its enabled form

### Requirement: Scheduled Messages Section

The system SHALL display two distinct Scheduled Messages subsections on the Home Tab. When `config.cron.userSchedules` is `false`, the **"Scheduled Messages"** (user-created) subsection SHALL NOT be rendered for any user role, regardless of whether matching jobs exist on disk. The **"Plugin Scheduled Messages"** subsection visibility is unaffected by `config.cron.userSchedules` and continues to follow its existing admin-only rule. When `config.cron.userSchedules` is `true`, both subsections render according to the existing rules below.

1. **"Scheduled Messages"** — user-created cron jobs (where `pluginManaged !== true`). Visibility and management controls follow the existing rules (admin sees all, non-admin sees own, with Enable/Disable, Delete, and Edit-modal controls). The job's `skipConditions` is NOT rendered inline on the Home Tab row — admins and creators edit the field through the scheduled-message edit modal, which pre-fills the stored value. When the job has a `name`, it SHALL be rendered as a bold prefix followed by an em-dash (`*<name>* — `) at the start of the row's text. When the job has no `name` (legacy rows), the prefix SHALL be omitted entirely.

2. **"Plugin Scheduled Messages"** — plugin-managed cron jobs (where `pluginManaged === true`). Visible to admins and owners only. Each row is read-only: it displays target channel, schedule description (human-readable), the owning plugin name, last run status, and a single Enable/Disable button (the admin-override). There SHALL be NO Edit and NO Delete control on these rows — content management is performed by editing the plugin's config block (`data/config.json`). When the job has a `name` (set by the plugin's `reconcileCronJobs` call), it SHALL be rendered with the same `*<name>* — ` prefix. When `name` is absent, the prefix SHALL be omitted.

In both subsections, the name SHALL pass through the existing Slack mrkdwn-escape helper before being wrapped in `*…*` markers, so user-typed or plugin-typed names cannot break row layout. The entire row SHALL remain on a single line (the prefix replaces no existing fields).

The scheduled-message edit modal (user-created jobs only) SHALL include a required Name input block as the first input above the channel block:

- `block_id`: `cron_name_block`
- `action_id`: `cron_name`
- `type`: `plain_text_input` with `max_length: 80`
- Label, placeholder, and hint sourced from the i18n dictionary (`home.scheduled.name_label`, `home.scheduled.name_placeholder`, `home.scheduled.name_hint`)
- When editing an existing job, `initial_value` SHALL be `job.name` when set (legacy nameless jobs render with no initial value)
- Modal submission SHALL reject an empty (whitespace-only) name with a block-level validation error; the modal re-opens with the error surfaced inline

The modal-submission handler SHALL trim the submitted name and pass it as the `name` parameter to `createJob` (for new schedules) or `updateJob` (for edits).

#### Scenario: Admin sees all user-created scheduled messages in the first subsection

- **GIVEN** the current user is an admin or owner
- **WHEN** building the home view
- **AND** at least one cron job exists with `pluginManaged !== true`
- **THEN** display the "Scheduled Messages" subsection with all such cron jobs
- **AND** each job shows: target channel, schedule description (human-readable), creator, last run status
- **AND** when a job has a `name`, the row text starts with `*<name>* — `
- **AND** each job has [Disable]/[Enable] and [Delete] buttons (plus the Edit modal entry point)

#### Scenario: Non-admin sees own user-created scheduled messages

- **GIVEN** the current user is a dev or member
- **WHEN** building the home view
- **AND** the user has created cron jobs (with `pluginManaged !== true`)
- **THEN** display the "Scheduled Messages" subsection with only their own jobs
- **AND** when a job has a `name`, the row text starts with `*<name>* — `
- **AND** each job has [Disable]/[Enable] and [Delete] buttons

#### Scenario: Admin sees all plugin-managed scheduled messages in the second subsection

- **GIVEN** the current user is an admin or owner
- **WHEN** building the home view
- **AND** at least one cron job exists with `pluginManaged === true`
- **THEN** display the "Plugin Scheduled Messages" subsection with all such jobs
- **AND** each row shows: target channel, schedule description (human-readable), the `plugin` name, last run status
- **AND** when a job has a `name` (set by the plugin via `reconcileCronJobs`), the row text starts with `*<name>* — `
- **AND** each row has a single [Disable]/[Enable] button
- **AND** each row does NOT have a [Delete] button
- **AND** each row does NOT have an Edit affordance
- **AND** the subsection includes a one-line hint pointing to the relevant config section (e.g. "Manage in data/config.json under trivia.games")

#### Scenario: Non-admin does NOT see plugin-managed scheduled messages

- **GIVEN** the current user is a dev or member (not admin/owner)
- **WHEN** building the home view
- **THEN** the "Plugin Scheduled Messages" subsection is NOT displayed regardless of plugin-managed jobs existing

#### Scenario: No user-created scheduled messages

- **GIVEN** the user has no visible cron jobs with `pluginManaged !== true`
- **WHEN** building the home view
- **THEN** the "Scheduled Messages" subsection is NOT displayed
- **AND** the "Plugin Scheduled Messages" subsection (if any) is rendered independently

#### Scenario: No plugin-managed scheduled messages

- **GIVEN** no cron jobs exist with `pluginManaged === true`
- **WHEN** building the home view
- **THEN** the "Plugin Scheduled Messages" subsection is NOT displayed
- **AND** the "Scheduled Messages" subsection (if any) is rendered independently

#### Scenario: Toggle scheduled message from Home Tab

- **WHEN** an admin clicks [Enable] or [Disable] on a scheduled message (either subsection)
- **THEN** the system toggles the job's enabled state
- **AND** refreshes the Home Tab view

#### Scenario: Delete scheduled message from Home Tab

- **WHEN** an admin clicks [Delete] on a user-created scheduled message
- **THEN** the system deletes the cron job
- **AND** refreshes the Home Tab view

#### Scenario: Delete control absent for plugin-managed messages

- **WHEN** an admin views the "Plugin Scheduled Messages" subsection
- **THEN** no [Delete] button is rendered on any row
- **AND** even if the client somehow submits a delete action for a `pluginManaged === true` job, the server-side handler rejects the action with an error

#### Scenario: Non-admin manages own user-created messages

- **WHEN** a non-admin clicks [Enable]/[Disable] or [Delete] on their own user-created scheduled message
- **THEN** the system performs the action
- **AND** refreshes the Home Tab view

#### Scenario: Scheduled Messages subsection hidden when user schedules disabled

- **GIVEN** `config.cron.userSchedules` is `false`
- **WHEN** any user opens the Home Tab
- **THEN** the "Scheduled Messages" (user-created) subsection SHALL NOT be displayed
- **AND** the "Plugin Scheduled Messages" subsection renders according to its own admin-only rule (unaffected by `userSchedules`)

#### Scenario: Admin sees all user-created scheduled messages in the first subsection

- **GIVEN** the current user is an admin or owner
- **AND** `config.cron.userSchedules` is `true`
- **WHEN** building the home view
- **AND** at least one cron job exists with `pluginManaged !== true`
- **THEN** display the "Scheduled Messages" subsection with all such cron jobs
- **AND** each job shows: target channel, schedule description (human-readable), creator, last run status
- **AND** when a job has a `name`, the row text starts with `*<name>* — `
- **AND** each job has [Disable]/[Enable] and [Delete] buttons (plus the Edit modal entry point)

#### Scenario: Non-admin sees own user-created scheduled messages

- **GIVEN** the current user is a dev or member
- **AND** `config.cron.userSchedules` is `true`
- **WHEN** building the home view
- **AND** the user has created cron jobs (with `pluginManaged !== true`)
- **THEN** display the "Scheduled Messages" subsection with only their own jobs
- **AND** when a job has a `name`, the row text starts with `*<name>* — `
- **AND** each job has [Disable]/[Enable] and [Delete] buttons

#### Scenario: Admin sees all plugin-managed scheduled messages in the second subsection

- **GIVEN** the current user is an admin or owner
- **WHEN** building the home view
- **AND** at least one cron job exists with `pluginManaged === true`
- **THEN** display the "Plugin Scheduled Messages" subsection with all such jobs
- **AND** each row shows: target channel, schedule description (human-readable), the `plugin` name, last run status
- **AND** when a job has a `name` (set by the plugin via `reconcileCronJobs`), the row text starts with `*<name>* — `
- **AND** each row has a single [Disable]/[Enable] button
- **AND** each row does NOT have a [Delete] button
- **AND** each row does NOT have an Edit affordance
- **AND** the subsection includes a one-line hint pointing to the relevant config section (e.g. "Manage in data/config.json under trivia.games")

#### Scenario: Non-admin does NOT see plugin-managed scheduled messages

- **GIVEN** the current user is a dev or member (not admin/owner)
- **WHEN** building the home view
- **THEN** the "Plugin Scheduled Messages" subsection is NOT displayed regardless of plugin-managed jobs existing

#### Scenario: No user-created scheduled messages

- **GIVEN** the user has no visible cron jobs with `pluginManaged !== true`
- **AND** `config.cron.userSchedules` is `true`
- **WHEN** building the home view
- **THEN** the "Scheduled Messages" subsection is NOT displayed
- **AND** the "Plugin Scheduled Messages" subsection (if any) is rendered independently

#### Scenario: No plugin-managed scheduled messages

- **GIVEN** no cron jobs exist with `pluginManaged === true`
- **WHEN** building the home view
- **THEN** the "Plugin Scheduled Messages" subsection is NOT displayed
- **AND** the "Scheduled Messages" subsection (if any) is rendered independently

#### Scenario: Toggle scheduled message from Home Tab

- **WHEN** an admin clicks [Enable] or [Disable] on a scheduled message (either subsection)
- **THEN** the system toggles the job's enabled state
- **AND** refreshes the Home Tab view

#### Scenario: Delete scheduled message from Home Tab

- **WHEN** an admin clicks [Delete] on a user-created scheduled message
- **THEN** the system deletes the cron job
- **AND** refreshes the Home Tab view

#### Scenario: Delete control absent for plugin-managed messages

- **WHEN** an admin views the "Plugin Scheduled Messages" subsection
- **THEN** no [Delete] button is rendered on any row
- **AND** even if the client somehow submits a delete action for a `pluginManaged === true` job, the server-side handler rejects the action with an error

#### Scenario: Non-admin manages own user-created messages

- **WHEN** a non-admin clicks [Enable]/[Disable] or [Delete] on their own user-created scheduled message
- **THEN** the system performs the action
- **AND** refreshes the Home Tab view

#### Scenario: Job display format

- **WHEN** rendering a cron job in either Home Tab subsection
- **THEN** display the job as: channel name, human-readable schedule (e.g., "Every day at 9:00 AM ET")
- **AND** when the job has a `name`, prepend `*<name>* — ` (with the name passed through the mrkdwn-escape helper) to the row text
- **AND** when the job has no `name`, render the row without any name prefix (unchanged from pre-change behavior)
- **AND** for user-created jobs, include the creator mention
- **AND** for plugin-managed jobs, include the owning plugin name instead of a creator mention
- **AND** if the job has `lastRunStatus: "error"`, show a warning indicator
- **AND** if the job has `lastRunStatus: "skipped"`, show a distinct "skipped" indicator (neutral, not a warning)
- **AND** if the job is disabled, show a "paused" label
- **AND** if the job is `oneShot`, show a "one-time" label
- **AND** `skipConditions` is NOT rendered inline on the row — it is only visible inside the edit modal (user-created jobs only)
- **AND** the entire row text SHALL remain a single line (no manual line breaks)

#### Scenario: Edit modal exposes name as a required field

- **WHEN** an admin, an owner, or the job's creator opens the scheduled-message edit modal for a user-created job (matching the existing enable/disable/delete permission gate)
- **THEN** the modal includes a `cron_name_block` plain-text input at the top
- **AND** the input is required
- **AND** the input's `initial_value` is the stored `job.name` when present, otherwise empty
- **AND** the input's label, placeholder, and hint are sourced from the i18n dictionary
- **AND** submitting the modal with a non-empty name updates the job's `name` field
- **AND** submitting the modal with an empty (whitespace-only) name displays a block-level validation error and the modal stays open

#### Scenario: Edit modal exposes skipConditions

- **WHEN** an admin, an owner, or the job's creator opens the scheduled-message edit modal for a user-created job (matching the existing enable/disable/delete permission gate)
- **THEN** the modal includes a multi-line input for `skipConditions` pre-filled with the stored value (empty when unset)
- **AND** submitting the modal with a non-empty value updates the job's `skipConditions`
- **AND** submitting the modal with an empty value clears the job's `skipConditions`
- **AND** the Home Tab refreshes to reflect the change

#### Scenario: Edit modal does NOT open for plugin-managed jobs

- **WHEN** any user attempts to open the scheduled-message edit modal for a job where `pluginManaged === true`
- **THEN** the request SHALL be rejected
- **AND** the modal is not displayed
- **AND** the Home Tab refreshes without changes (defensive: the UI does not surface an Edit affordance for these jobs in the first place)

#### Scenario: Non-admin non-creator cannot edit

- **WHEN** a non-admin user who did not create the job attempts to edit `skipConditions` on it
- **THEN** the edit action SHALL be rejected (the UI does not expose the edit control for such users, and any direct submission is rejected server-side)

## ADDED Requirements

### Requirement: Localized Home Tab Strings

All user-visible strings rendered by Home Tab code (section headers, button labels, modal titles and labels, hint text, status indicators, empty-state messages, role badges, banner text) SHALL be sourced from the localization dictionary via the `t()` helper, not from inline literal strings.

Dynamic values that are not natural-language text (repository names, channel mentions, user mentions, branch names, commit SHAs, file paths, plugin names, ISO timestamps) SHALL pass through verbatim and SHALL NOT be looked up in the dictionary.

#### Scenario: Section headers rendered through t()

- **GIVEN** the configured language is `"fr"`
- **WHEN** any user opens the Home Tab
- **THEN** every section header (e.g. "Status", "Roles", "Repositories", "Settings", "Auto-Respond", "Scheduled Messages", "Plugin Scheduled Messages", "Configuration") is rendered in French
- **AND** the underlying call site uses `t(...)` with a dictionary key, not a literal string

#### Scenario: Button labels rendered through t()

- **GIVEN** the configured language is `"fr"`
- **WHEN** the Home Tab renders buttons (e.g. "Claim Ownership", "Add Admin", "Add Dev", "Transfer Ownership", "Add Rule", "Edit", "Enable", "Disable", "Delete", "Settings", "Save")
- **THEN** the visible button label is the French translation
- **AND** the underlying call site uses `t(...)` with a dictionary key

#### Scenario: Modal labels rendered through t()

- **GIVEN** the configured language is `"fr"`
- **WHEN** a user opens a Home-Tab-launched modal (Add Rule, Edit Rule, Settings, user selectors, scheduled-message edit)
- **THEN** every modal title, input label, hint, option label, and submit-button label is rendered in French via `t()`

#### Scenario: Empty-state and hint text rendered through t()

- **GIVEN** the configured language is `"fr"`
- **WHEN** the Home Tab renders an empty-state message (e.g. "No MCP servers configured", "No rules are configured") or a hint block (e.g. "Manage in data/config.json")
- **THEN** the rendered text is the French translation via `t()`

#### Scenario: Dynamic identifiers pass through unchanged

- **GIVEN** the configured language is `"fr"`
- **WHEN** the Home Tab renders a row that includes a repository name, channel mention `<#C123>`, user mention `<@U456>`, or plugin name
- **THEN** the identifier is rendered verbatim
- **AND** the surrounding natural-language text (e.g. "created by", "last run") is sourced via `t()`

#### Scenario: Snapshot tests run against EN baseline

- **GIVEN** the test suite default language is `"en"`
- **WHEN** existing Home Tab tests run
- **THEN** they pass without modification, producing the same English output as before localization

### Requirement: Schedule Rows Omit Channel Portion When Channelless

The Home Tab Scheduled Messages and Plugin Scheduled Messages subsections SHALL render rows for cron jobs that have no `channel` field, omitting the target-channel portion entirely (no `<#…>` mention, no fallback label, no placeholder text). All other row affordances — Name prefix, schedule description, owner / plugin name, last-run status, Enable/Disable button — SHALL render unchanged.

The intent is that channelless rows look identical to channel-bound rows in every respect EXCEPT that the channel reference is absent. Spacing, punctuation, and surrounding separators SHALL collapse cleanly when the channel piece is omitted (no double separators, no orphaned " — " glue).

#### Scenario: Channelless plugin-managed job omits channel reference

- **GIVEN** a plugin-managed cron job with `pluginManaged === true` and no `channel` field
- **WHEN** an admin opens the Home Tab
- **THEN** the row appears in the "Plugin Scheduled Messages" subsection
- **AND** the row text does NOT contain any `<#…>` channel mention
- **AND** the row text does NOT contain a placeholder/fallback label such as "(channelless)" or "No bound channel"
- **AND** the schedule description, plugin name, last-run status, and Enable/Disable button render exactly as for channel-bound plugin-managed rows

#### Scenario: Channelless row with a name prefix renders cleanly

- **GIVEN** a channelless plugin-managed cron job with `name: "Random Chatter"`
- **WHEN** the Home Tab renders the row
- **THEN** the row's text begins with `*Random Chatter* — ` followed by the rest of the description
- **AND** the channel portion is absent (not replaced by any placeholder)
- **AND** the leading and trailing whitespace/separators around the omitted channel piece collapse cleanly

#### Scenario: Channelless row does NOT show an Edit modal entry point

- **GIVEN** a channelless plugin-managed cron job
- **WHEN** the Home Tab renders the row
- **THEN** the row shows only Enable/Disable (the same restriction that applies to all plugin-managed rows)
- **AND** no Edit / Delete buttons appear

#### Scenario: Channelless row tolerates absent skipDates / skipConditions

- **GIVEN** a channelless plugin-managed cron job with no `skipDates` and no `skipConditions`
- **WHEN** the Home Tab renders the row
- **THEN** the row renders without crashing
- **AND** the existing rules for omitting skip indicators apply unchanged

### Requirement: Viewer-Relative Schedule Timezone Labels

On the Home Tab, the human-readable schedule description for a cron job SHALL render the timezone abbreviation conditionally rather than unconditionally. The abbreviation SHALL be omitted when the job's effective timezone matches the viewing user's Slack timezone, and SHALL be shown when they differ. This applies to both the "Scheduled Messages" and "Plugin Scheduled Messages" subsection rows AND to the plugin-cron detail modal.

The match SHALL be determined by comparing the rendered short timezone abbreviation (as produced by the locale formatter, e.g. `"EDT"`, `"UTC"`) computed at the job's next-run instant in each zone — NOT by comparing raw IANA timezone identifiers. Two distinct IANA zones that resolve to the same abbreviation at that instant (e.g. `America/Montreal` and `America/New_York` → `"EDT"`) SHALL therefore be treated as matching and render without a label.

The viewing user's timezone SHALL be sourced from the cached Slack user profile (`getUserInfo().tz`). When the viewer's timezone is unavailable (no `tz` on the Slack profile, or the lookup fails), the system SHALL fall back to always rendering the abbreviation for that viewer — the prior behavior — and SHALL NOT error.

This requirement governs Home Tab display only. Schedule descriptions returned to Claude or surfaced in tool-result confirmations (e.g. `create_scheduled_message`) are out of scope and continue to always include the abbreviation.

#### Scenario: Job timezone matches the viewer's timezone

- **GIVEN** a viewer whose Slack profile timezone is `America/Montreal`
- **AND** a cron job whose timezone is `America/Montreal`
- **WHEN** building the home view scheduled-message rows
- **THEN** the schedule description for that job SHALL NOT include a timezone abbreviation (e.g. `"Every day at 11:30 AM"`)

#### Scenario: Equivalent zones collapse to no label

- **GIVEN** a viewer whose Slack profile timezone is `America/Montreal`
- **AND** a cron job whose timezone is `America/New_York`
- **AND** both resolve to the same short abbreviation at the job's next-run instant
- **WHEN** building the home view scheduled-message rows
- **THEN** the schedule description SHALL NOT include a timezone abbreviation

#### Scenario: Job timezone differs from the viewer's timezone

- **GIVEN** a viewer whose Slack profile timezone is `America/Montreal`
- **AND** a cron job whose timezone is `UTC`
- **WHEN** building the home view scheduled-message rows
- **THEN** the schedule description SHALL include the job's timezone abbreviation (e.g. `"Every day at 3:30 PM UTC"`)

#### Scenario: Plugin-managed rows and detail modal follow the same rule

- **GIVEN** a viewer whose Slack profile timezone differs from a plugin-managed job's timezone
- **WHEN** the plugin-managed subsection rows and the plugin-cron detail modal are rendered
- **THEN** both SHALL include the job's timezone abbreviation
- **AND** when the timezones match, both SHALL omit it

#### Scenario: Viewer has no timezone on their Slack profile

- **GIVEN** a viewer whose Slack profile has no `tz` value
- **WHEN** building the home view scheduled-message rows
- **THEN** every schedule description SHALL include the job's timezone abbreviation (always-show fallback)
- **AND** no error SHALL be raised

