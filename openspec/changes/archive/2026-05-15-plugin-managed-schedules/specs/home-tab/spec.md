## MODIFIED Requirements

### Requirement: Scheduled Messages Section

The system SHALL display two distinct Scheduled Messages subsections on the Home Tab:

1. **"Scheduled Messages"** — user-created cron jobs (where `pluginManaged !== true`). Visibility and management controls follow the existing rules (admin sees all, non-admin sees own, with Enable/Disable, Delete, and Edit-modal controls). The job's `skipConditions` is NOT rendered inline on the Home Tab row — admins and creators edit the field through the scheduled-message edit modal, which pre-fills the stored value.

2. **"Plugin Scheduled Messages"** — plugin-managed cron jobs (where `pluginManaged === true`). Visible to admins and owners only. Each row is read-only: it displays target channel, schedule description (human-readable), the owning plugin name, last run status, and a single Enable/Disable button (the admin-override). There SHALL be NO Edit and NO Delete control on these rows — content management is performed by editing the plugin's config block (`data/config.json`).

#### Scenario: Admin sees all user-created scheduled messages in the first subsection

- **GIVEN** the current user is an admin or owner
- **WHEN** building the home view
- **AND** at least one cron job exists with `pluginManaged !== true`
- **THEN** display the "Scheduled Messages" subsection with all such cron jobs
- **AND** each job shows: target channel, schedule description (human-readable), creator, last run status
- **AND** each job has [Disable]/[Enable] and [Delete] buttons (plus the Edit modal entry point)

#### Scenario: Non-admin sees own user-created scheduled messages

- **GIVEN** the current user is a dev or member
- **WHEN** building the home view
- **AND** the user has created cron jobs (with `pluginManaged !== true`)
- **THEN** display the "Scheduled Messages" subsection with only their own jobs
- **AND** each job has [Disable]/[Enable] and [Delete] buttons

#### Scenario: Admin sees all plugin-managed scheduled messages in the second subsection

- **GIVEN** the current user is an admin or owner
- **WHEN** building the home view
- **AND** at least one cron job exists with `pluginManaged === true`
- **THEN** display the "Plugin Scheduled Messages" subsection with all such jobs
- **AND** each row shows: target channel, schedule description (human-readable), the `plugin` name, last run status
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

#### Scenario: Job display format

- **WHEN** rendering a cron job in either Home Tab subsection
- **THEN** display the job as: channel name, human-readable schedule (e.g., "Every day at 9:00 AM ET")
- **AND** for user-created jobs, include the creator mention
- **AND** for plugin-managed jobs, include the owning plugin name instead of a creator mention
- **AND** if the job has `lastRunStatus: "error"`, show a warning indicator
- **AND** if the job has `lastRunStatus: "skipped"`, show a distinct "skipped" indicator (neutral, not a warning)
- **AND** if the job is disabled, show a "paused" label
- **AND** if the job is `oneShot`, show a "one-time" label
- **AND** `skipConditions` is NOT rendered inline on the row — it is only visible inside the edit modal (user-created jobs only)

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
