## MODIFIED Requirements

### Requirement: list_scheduled_messages Tool

The system SHALL provide a `list_scheduled_messages` tool for listing cron jobs.

The tool SHALL accept the following optional arguments:

- `channel` — filter results to jobs targeting the named channel (string ID or human name).
- `plugin` — filter results to jobs whose `plugin` field matches AND `pluginManaged === true`.
- `includeOtherUsers` (boolean, admin/owner only) — when `true`, the result set additionally includes jobs created by users other than the caller. When `false` or omitted (or when the caller is not an admin/owner), the result set is limited to "the caller's own jobs PLUS all plugin-managed jobs (`createdBy === null`)".

Filters (`channel`, `plugin`) SHALL always narrow within the chosen scope. They SHALL NOT depend on `includeOtherUsers` to produce non-empty results when matching rows exist in the scope.

The previously-supported `all: true` argument SHALL be removed. The replacement `includeOtherUsers` argument SHALL have the same admin-only privacy-bypass semantics for cross-user visibility.

#### Scenario: Default scope lists caller's jobs and plugin-managed jobs

- **GIVEN** the registry contains a user-created job owned by the caller, a user-created job owned by a different user, and a plugin-managed job (`createdBy: null`, `pluginManaged: true`)
- **WHEN** Claude calls `list_scheduled_messages` with no arguments
- **THEN** the response includes the caller's job
- **AND** the response includes the plugin-managed job
- **AND** the response does NOT include the other user's job
- **AND** each entry includes: id, channel, human-readable schedule, prompt/staticMessage summary, enabled status, last run info
- **AND** each entry includes `skipConditions` when set on the job (omitted otherwise). `skipConditions` is returned to anyone allowed to see the job (creator for their own jobs, admins/owners for all jobs) — it mirrors the visibility of `prompt` and `requiredTools`
- **AND** each entry's last-run status SHALL surface `"skipped"` distinctly from `"success"` and `"error"` when the most recent run was skipped

#### Scenario: List jobs for a channel applies within default scope

- **WHEN** Claude calls `list_scheduled_messages` with `channel: "C123"`
- **THEN** the tool returns only jobs targeting that channel within the default scope (caller's own + plugin-managed)
- **AND** plugin-managed jobs whose `channel` matches SHALL be included
- **AND** plugin-managed channelless jobs (those with no `channel` set) SHALL NOT match a channel filter

#### Scenario: List jobs for a plugin returns plugin-managed jobs in default scope

- **GIVEN** the registry contains a plugin-managed trivia job
- **WHEN** Claude calls `list_scheduled_messages` with `plugin: "trivia"` and no other arguments
- **THEN** the response includes the plugin-managed trivia job
- **AND** the response does NOT include user-created jobs (with or without a `plugin` field)

#### Scenario: Admin includes other users' jobs with includeOtherUsers

- **GIVEN** the caller has role `admin` or `owner`
- **AND** the registry contains a user-created job owned by a different user
- **WHEN** Claude calls `list_scheduled_messages` with `includeOtherUsers: true`
- **THEN** the response includes the other user's job
- **AND** the response includes the caller's own jobs
- **AND** the response includes all plugin-managed jobs

#### Scenario: Non-admin passing includeOtherUsers falls back to default scope

- **GIVEN** the caller has role below `admin`
- **WHEN** Claude calls `list_scheduled_messages` with `includeOtherUsers: true`
- **THEN** the response is identical to the default-scope response (caller's own + plugin-managed)
- **AND** the tool SHALL NOT return an error

#### Scenario: No scheduled messages

- **WHEN** no cron jobs match the filter
- **THEN** the tool returns an empty list with a descriptive message
