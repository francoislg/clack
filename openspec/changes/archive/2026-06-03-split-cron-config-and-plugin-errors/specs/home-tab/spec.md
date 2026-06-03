## ADDED Requirements

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

## MODIFIED Requirements

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
