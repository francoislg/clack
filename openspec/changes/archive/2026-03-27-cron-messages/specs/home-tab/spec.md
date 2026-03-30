## ADDED Requirements

### Requirement: Scheduled Messages Section

The system SHALL display a Scheduled Messages section on the Home Tab with role-based visibility and management controls.

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
- **AND** if the job is disabled, show a "paused" label
- **AND** if the job is `oneShot`, show a "one-time" label
