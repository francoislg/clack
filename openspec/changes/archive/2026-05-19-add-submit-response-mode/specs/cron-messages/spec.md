## MODIFIED Requirements

### Requirement: Cron Job Data Model

The system SHALL persist scheduled messages as cron jobs in `data/state/cron-jobs.json` with in-memory caching.

#### Scenario: Cron job structure

- **WHEN** a cron job is created
- **THEN** it SHALL contain: `id` (UUID), `cronExpression` (cron string), `channel` (Slack channel ID), `createdBy` (Slack user ID OR `null` for jobs that have no human creator), `createdAt` (ISO timestamp), `enabled` (boolean), `timezone` (IANA timezone string)
- **AND** either `prompt` (string, for dynamic Claude-powered execution) or `staticMessage` (string, for direct posting), or both
- **AND** optionally `oneShot` (boolean), `repositories` (string array), `lastRunAt` (ISO timestamp), `lastRunStatus` ("success", "error", or "skipped")
- **AND** optionally `requiredTools` (string array of fully-qualified MCP tool names that must be called during a dynamic run before `submit_response` will deliver)
- **AND** optionally `plugin` (name of a loaded Clack plugin the job is associated with — used to pick up the plugin's declared scheduled-run default required tools)
- **AND** optionally `pluginManaged` (boolean; when `true`, the job was created by a plugin's `reconcileCronJobs` call and the Home Tab presents it as read-only with admin-override controls only — see the `plugin-cron-reconciliation` capability)
- **AND** optionally `specKey` (string; stable identity within a plugin's reconcile owner — present when and only when `pluginManaged` is `true`)
- **AND** optionally `skipConditions` (string; when set, the scheduled run evaluates these free-form conditions and may decline delivery via `submit_response` with `skip_response: true`)
- **AND** optionally `systemActor` (string; identifies the non-user origin of a system-owned job — present when and only when `createdBy` is `null`. The value SHALL be a colon-delimited source identifier, with `"plugin:<ownerKey>"` reserved for jobs emitted by `sdk.reconcileCronJobs`)
- **AND** optionally `submitResponseMode` (one of `"always" | "optional" | "skipped"`; when set, overrides the auto-derived `allowSkip` rule and selects the `submit_response` schema variant — see the `submit-response-mode` capability)

#### Scenario: createdBy is null only for system-owned jobs

- **GIVEN** any persisted cron job
- **WHEN** the row has `createdBy: null`
- **THEN** the row SHALL also have `systemActor` set to a non-empty string
- **AND** the row SHALL also have `pluginManaged: true` (when the system actor is a plugin reconcile owner — `systemActor` starting with `"plugin:"`)
- **AND** conversely, any row with `createdBy` set to a non-empty string SHALL NOT have a `systemActor` field

#### Scenario: Load jobs from disk

- **WHEN** the system starts or first accesses cron jobs
- **THEN** it SHALL load `data/state/cron-jobs.json` into an in-memory cache
- **AND** if the file does not exist, initialize with an empty jobs array
- **AND** jobs without a `requiredTools` field load normally (field is optional and defaults to absent)
- **AND** jobs without a `skipConditions` field load normally (field is optional and defaults to absent)
- **AND** jobs without `pluginManaged` / `specKey` fields load normally (both optional, defaults absent for user-created jobs)
- **AND** jobs without a `submitResponseMode` field load normally (field is optional and defaults to absent; auto-derivation rules apply unchanged)
- **AND** jobs with `createdBy: null` and a `systemActor` field load normally without throwing
- **AND** legacy jobs persisted with `createdBy: "<pluginName>"` and `pluginManaged: true` (pre-migration shape) are rewritten by the boot migration introduced in the `add-system-role-tier` change to `createdBy: null` + `systemActor: "plugin:<pluginName>"`

#### Scenario: Persist jobs to disk

- **WHEN** a cron job is created, updated, or deleted
- **THEN** the system SHALL write the full state to `data/state/cron-jobs.json`
- **AND** update the in-memory cache atomically
- **AND** include `requiredTools` in the serialized form when present
- **AND** include `skipConditions` in the serialized form when present (omitted when unset or empty string)
- **AND** include `submitResponseMode` in the serialized form when present (omitted when unset)
- **AND** include `pluginManaged: true` in the serialized form when the job was created via `reconcileCronJobs` (omitted for user-created jobs)
- **AND** include `specKey` in the serialized form when `pluginManaged` is `true`
- **AND** include `systemActor` in the serialized form when `createdBy` is `null` (omitted for user-created jobs)
- **AND** serialize `createdBy: null` explicitly (NOT as an absent field) so the system-owned shape round-trips through JSON

## ADDED Requirements

### Requirement: submitResponseMode CRUD

The cron job CRUD operations (`createCronJob`, `updateJob`) SHALL accept and persist the optional `submitResponseMode` field. `updateJob` SHALL follow the same semantics as the existing optional fields: explicit value overwrites, undefined leaves unchanged, an empty/`null` value clears the field.

#### Scenario: Create with submitResponseMode

- **WHEN** a cron job is created with `submitResponseMode: "skipped"`
- **THEN** the field is stored on the cron job record verbatim
- **AND** the field is included when the job is serialized to disk

#### Scenario: Create without submitResponseMode

- **WHEN** a cron job is created without `submitResponseMode` (field omitted)
- **THEN** the stored cron job has no `submitResponseMode` field
- **AND** the run fires under today's auto-derivation rules

#### Scenario: Update sets submitResponseMode

- **WHEN** `updateJob` is called with `submitResponseMode: "optional"`
- **THEN** the field is stored on the cron job record verbatim
- **AND** subsequent runs use the new value

#### Scenario: Update clears submitResponseMode

- **WHEN** `updateJob` is called with `submitResponseMode: null` (or an empty string)
- **THEN** the field is removed from the cron job record
- **AND** subsequent runs fall back to auto-derivation rules

#### Scenario: Update leaves submitResponseMode unchanged

- **WHEN** `updateJob` is called without `submitResponseMode` in the parameters (undefined)
- **THEN** the stored field is left unchanged

#### Scenario: reconcileCronJobs propagates the field

- **GIVEN** a plugin-managed cron job whose spec sets `submitResponseMode: "skipped"`
- **WHEN** `reconcileCronJobs` runs
- **THEN** the corresponding `updateJob` (or `createJob`) call includes `submitResponseMode: "skipped"`
- **AND** the persisted row carries the field after reconcile
- **AND** dropping the field from a subsequent spec (with the same specKey) clears the persisted value (matching `skipConditions` semantics)
