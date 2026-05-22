## ADDED Requirements

### Requirement: Schedule Name Field

The `CronJob` data model SHALL include an optional `name?: string` field carrying a short human-readable label (1-80 characters) describing what the schedule does. The field SHALL be decorative: it SHALL NOT be used as a lookup key, SHALL NOT be required for uniqueness, and SHALL NOT affect cron evaluation, execution, or persistence beyond storage and rendering.

The `CreateCronJobParams` interface SHALL accept an optional `name?: string`. Enforcement of "name is required at create time" SHALL live at the user-facing boundaries — the `create_scheduled_message` tool's zod schema and the Home Tab edit modal — rather than in storage; plugin-managed reconcile call sites can produce nameless jobs when their `CronJobSpec.name` is absent. `createJob` SHALL trim the supplied name and store it only when the trimmed value is non-empty; empty/whitespace-only values SHALL produce a job with `name: undefined`. The `UpdateCronJobParams` interface SHALL accept an optional `name?: string`: `undefined` leaves the field unchanged, empty string after whitespace-trim clears the field. Persisted jobs whose `name` is absent (legacy rows, plugin-managed rows whose plugin has not adopted the field) SHALL load and round-trip unchanged.

#### Scenario: New cron job stores a name

- **GIVEN** `createJob` is called with `name: "Morning PR roundup"` and otherwise-valid parameters
- **THEN** the persisted job carries `name: "Morning PR roundup"`
- **AND** the field is included in the serialized form

#### Scenario: Legacy nameless job loads without error

- **GIVEN** `data/state/cron-jobs.json` contains a job persisted before this change (no `name` field)
- **WHEN** `loadJobs()` runs
- **THEN** the job loads normally with `name === undefined`
- **AND** no migration is performed

#### Scenario: Update with new name overwrites stored value

- **GIVEN** a persisted job with `name: "Old label"`
- **WHEN** `updateJob(id, { name: "New label" })` is called
- **THEN** the job's `name` field becomes `"New label"`

#### Scenario: Update with empty string clears the name

- **GIVEN** a persisted job with `name: "Some label"`
- **WHEN** `updateJob(id, { name: "" })` is called
- **THEN** the job's `name` field is removed from the persisted shape

#### Scenario: Update without name leaves field untouched

- **GIVEN** a persisted job with `name: "Some label"`
- **WHEN** `updateJob(id, { prompt: "new prompt" })` is called (no `name` key)
- **THEN** the job's `name` field remains `"Some label"`

### Requirement: Synchronous In-Memory Job Lookup Accessor

The `cronJobs` module SHALL export a synchronous accessor `getJobByIdFromCache(id: string): CronJob | null` that returns a job from the in-memory cache without touching disk. The accessor SHALL return `null` when the cache is empty (cold start) or when no job matches the given id. The accessor SHALL NOT load, mutate, or persist state.

The accessor is intended for tight-loop callers that need to enrich tool labels at streaming time and cannot tolerate async I/O.

#### Scenario: Cached job returned synchronously

- **GIVEN** the cron-jobs cache is warm and contains a job with `id: "abc"`
- **WHEN** `getJobByIdFromCache("abc")` is called
- **THEN** the function returns the job object synchronously
- **AND** no disk read is performed

#### Scenario: Cold cache returns null without throwing

- **GIVEN** the cron-jobs cache has not been populated
- **WHEN** `getJobByIdFromCache("abc")` is called
- **THEN** the function returns `null`
- **AND** no disk read is triggered
- **AND** no exception is thrown

#### Scenario: Missing id returns null

- **GIVEN** the cron-jobs cache is warm but contains no job with id `"xyz"`
- **WHEN** `getJobByIdFromCache("xyz")` is called
- **THEN** the function returns `null`

### Requirement: create_scheduled_message Requires a Name

The `create_scheduled_message` tool's input schema SHALL declare a required `name` string argument (1-80 characters). The tool's description SHALL nudge Claude to author a short, descriptive label (3-6 words) summarizing what the schedule does whenever the user has not supplied one explicitly. The resolved name SHALL be passed through to `createJob` and stored on the resulting `CronJob.name` field.

#### Scenario: Tool rejects calls without a name

- **WHEN** Claude calls `create_scheduled_message` without supplying `name`
- **THEN** the input validation layer rejects the call before any cron job is persisted

#### Scenario: Name is persisted on the new job

- **WHEN** Claude calls `create_scheduled_message` with `name: "Weekly metrics digest"` and otherwise-valid arguments
- **THEN** the resulting cron job is persisted with `name: "Weekly metrics digest"`
- **AND** the tool's text result includes the `name` value alongside the other returned fields

#### Scenario: Name is sanitized to 80 characters or fewer

- **WHEN** Claude calls `create_scheduled_message` with a `name` longer than 80 characters
- **THEN** the input validation layer rejects the call before any cron job is persisted

### Requirement: update_scheduled_message Accepts an Optional Name

The `update_scheduled_message` tool's input schema SHALL declare an optional `name?: string` argument (0-80 characters). When `name` is omitted, the persisted `name` SHALL be unchanged. When `name === ""` after whitespace-trim, the persisted `name` SHALL be cleared. Otherwise, the persisted `name` SHALL be replaced with the new value.

#### Scenario: Omitting name leaves it unchanged

- **GIVEN** a cron job with `name: "Existing label"`
- **WHEN** Claude calls `update_scheduled_message` with `id` plus other fields but no `name`
- **THEN** the persisted job retains `name: "Existing label"`

#### Scenario: Empty name clears the field

- **GIVEN** a cron job with `name: "Existing label"`
- **WHEN** Claude calls `update_scheduled_message` with `id` and `name: ""`
- **THEN** the persisted job no longer carries a `name` field

#### Scenario: Non-empty name replaces the field

- **GIVEN** a cron job with `name: "Existing label"`
- **WHEN** Claude calls `update_scheduled_message` with `id` and `name: "Renamed"`
- **THEN** the persisted job has `name: "Renamed"`
