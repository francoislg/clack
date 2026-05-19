## MODIFIED Requirements

### Requirement: Cron Job Data Model

The system SHALL persist scheduled messages as cron jobs in `data/state/cron-jobs.json` with in-memory caching.

#### Scenario: Cron job structure

- **WHEN** a cron job is created
- **THEN** it SHALL contain: `id` (UUID), `cronExpression` (cron string), `channel` (Slack channel ID), `createdBy` (Slack user ID), `createdAt` (ISO timestamp), `enabled` (boolean), `timezone` (IANA timezone string)
- **AND** either `prompt` (string, for dynamic Claude-powered execution) or `staticMessage` (string, for direct posting), or both
- **AND** optionally `oneShot` (boolean), `repositories` (string array), `lastRunAt` (ISO timestamp), `lastRunStatus` ("success", "error", or "skipped")
- **AND** optionally `requiredTools` (string array of fully-qualified MCP tool names that must be called during a dynamic run before `submit_response` will deliver)
- **AND** optionally `plugin` (name of a loaded Clack plugin the job is associated with — used to pick up the plugin's declared scheduled-run default required tools)
- **AND** optionally `pluginManaged` (boolean; when `true`, the job was created by a plugin's `reconcileCronJobs` call and the Home Tab presents it as read-only with admin-override controls only — see the `plugin-cron-reconciliation` capability)
- **AND** optionally `specKey` (string; stable identity within a plugin's reconcile owner — present when and only when `pluginManaged` is `true`)
- **AND** optionally `skipConditions` (string; when set, the scheduled run evaluates these free-form conditions and may decline delivery via `submit_response` with `skip_response: true`)

#### Scenario: Load jobs from disk

- **WHEN** the system starts or first accesses cron jobs
- **THEN** it SHALL load `data/state/cron-jobs.json` into an in-memory cache
- **AND** if the file does not exist, initialize with an empty jobs array
- **AND** jobs without a `requiredTools` field load normally (field is optional and defaults to absent)
- **AND** jobs without a `skipConditions` field load normally (field is optional and defaults to absent)
- **AND** jobs without `pluginManaged` / `specKey` fields load normally (both optional, defaults absent for user-created jobs)

#### Scenario: Persist jobs to disk

- **WHEN** a cron job is created, updated, or deleted
- **THEN** the system SHALL write the full state to `data/state/cron-jobs.json`
- **AND** update the in-memory cache atomically
- **AND** include `requiredTools` in the serialized form when present
- **AND** include `skipConditions` in the serialized form when present (omitted when unset or empty string)
- **AND** include `pluginManaged: true` in the serialized form when the job was created via `reconcileCronJobs` (omitted for user-created jobs)
- **AND** include `specKey` in the serialized form when `pluginManaged` is `true`

## ADDED Requirements

### Requirement: Plugin-Managed Cron Jobs Are Not Directly Editable Via User-Facing Tools

The existing `update_scheduled_message`, `delete_scheduled_message`, and `create_scheduled_message` tools (and any equivalent Home-Tab edit/delete actions for user-created jobs) SHALL refuse to modify or delete jobs where `pluginManaged === true`. Toggling `enabled` SHALL still be permitted (this is the admin-override semantics).

#### Scenario: Update tool rejects plugin-managed job

- **GIVEN** a cron job with `pluginManaged === true`
- **WHEN** Claude (or an admin tool call) invokes `update_scheduled_message` with that job's `id` and any field change (other than `enabled`)
- **THEN** the tool returns an error indicating the job is plugin-managed and content edits go through the plugin's config

#### Scenario: Delete tool rejects plugin-managed job

- **GIVEN** a cron job with `pluginManaged === true`
- **WHEN** Claude (or an admin tool call) invokes `delete_scheduled_message` with that job's `id`
- **THEN** the tool returns an error indicating the job is plugin-managed and is removed by editing the plugin's config

#### Scenario: Toggling enabled is permitted

- **GIVEN** a cron job with `pluginManaged === true` and `enabled === true`
- **WHEN** the Home Tab toggle for that job is clicked by an admin
- **THEN** the job's `enabled` field flips to `false`
- **AND** the job persists with `pluginManaged: true` unchanged
- **AND** the next plugin reconcile preserves the admin's `enabled` value (per the `plugin-cron-reconciliation` capability)
