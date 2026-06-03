## ADDED Requirements

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
