# cron-messages Specification

## Purpose

Scheduled message system allowing users to create cron-based recurring or one-shot messages in Slack channels, executed either as dynamic Claude-powered sessions or static message posts, with tick-based scheduling, concurrency guards, and error notification.

## Requirements

### Requirement: Channel Input Resolution for Scheduled Message Creation

The `create_scheduled_message` tool SHALL resolve its `channel` argument via the shared `resolveChannelId` helper before persisting a cron job, guaranteeing that the stored `channel` field is always a posting-capable Slack channel ID (never a raw user ID).

#### Scenario: Channel name resolved before persistence

- **WHEN** Claude calls `create_scheduled_message` with a channel name (e.g., `#ops` or `ops`)
- **THEN** the tool delegates resolution to the shared `resolveChannelId` helper
- **AND** the resolved channel ID is stored on the cron job's `channel` field
- **AND** the raw name is NOT stored

#### Scenario: Channel ID passthrough

- **WHEN** Claude provides a channel ID (`C…`, `G…`, or `D…`)
- **THEN** the tool stores it directly on the cron job's `channel` field

#### Scenario: Self-DM user ID normalized

- **WHEN** Claude provides a user ID (`U…`) equal to the requesting user
- **THEN** the tool opens a DM via `openDmChannel` before creating the cron job
- **AND** stores the resulting `D…` channel ID on the cron job's `channel` field
- **AND** the raw user ID is NEVER stored

#### Scenario: Third-party user ID rejected

- **WHEN** Claude provides a user ID (`U…`) that does NOT match the requesting user
- **THEN** the tool returns an error explaining that only self-DMs are supported
- **AND** no cron job is created

#### Scenario: Resolution failure blocks creation

- **WHEN** channel resolution fails (e.g., channel not found, DM open error)
- **THEN** the tool returns the resolution error to Claude
- **AND** no cron job is created

### Requirement: Cron Job Data Model

The system SHALL persist scheduled messages as cron jobs in `data/state/cron-jobs.json` with in-memory caching.

#### Scenario: Cron job structure

- **WHEN** a cron job is created
- **THEN** it SHALL contain: `id` (UUID), `cronExpression` (cron string), `createdBy` (Slack user ID OR `null` for jobs that have no human creator), `createdAt` (ISO timestamp), `enabled` (boolean), `timezone` (IANA timezone string)
- **AND** optionally `channel` (Slack channel ID) — absent for channelless jobs whose delivery destination is decided at fire time by Claude via `post_to` actions
- **AND** either `prompt` (string, for dynamic Claude-powered execution) or `staticMessage` (string, for direct posting), or both
- **AND** optionally `oneShot` (boolean), `repositories` (string array), `lastRunAt` (ISO timestamp), `lastRunStatus` ("success", "error", or "skipped")
- **AND** optionally `requiredTools` (string array of fully-qualified MCP tool names that must be called during a dynamic run before `submit_response` will deliver)
- **AND** optionally `plugin` (name of a loaded Clack plugin the job is associated with — used to pick up the plugin's declared scheduled-run default required tools)
- **AND** optionally `pluginManaged` (boolean; when `true`, the job was created by a plugin's `reconcileCronJobs` call and the Home Tab presents it as read-only with admin-override controls only — see the `plugin-cron-reconciliation` capability)
- **AND** optionally `specKey` (string; stable identity within a plugin's reconcile owner — present when and only when `pluginManaged` is `true`)
- **AND** optionally `skipConditions` (string; when set, the scheduled run evaluates these free-form conditions and may decline delivery via `submit_response` with `skip_response: true`)
- **AND** optionally `systemActor` (string; identifies the non-user origin of a system-owned job — present when and only when `createdBy` is `null`. The value SHALL be a colon-delimited source identifier, with `"plugin:<ownerKey>"` reserved for jobs emitted by `sdk.reconcileCronJobs`)
- **AND** optionally `submitResponseMode` (one of `"always" | "optional" | "skipped"`; when set, overrides the auto-derived `allowSkip` rule and selects the `submit_response` schema variant — see the `submit-response-mode` capability)
- **AND** a static job (carrying `staticMessage` but no `prompt`) SHALL have a `channel` value — static jobs cannot be channelless because there is no Claude session to pick a destination

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
- **AND** jobs without a `channel` field load normally (channelless dynamic jobs)
- **AND** jobs with `createdBy: null` and a `systemActor` field load normally without throwing
- **AND** legacy jobs persisted with `createdBy: "<pluginName>"` and `pluginManaged: true` (pre-migration shape) are rewritten by the boot migration introduced in the `add-system-role-tier` change to `createdBy: null` + `systemActor: "plugin:<pluginName>"`

#### Scenario: Persist jobs to disk

- **WHEN** a cron job is created, updated, or deleted
- **THEN** the system SHALL write the full state to `data/state/cron-jobs.json`
- **AND** update the in-memory cache atomically
- **AND** include `channel` in the serialized form when present (omitted when the job is channelless)
- **AND** include `requiredTools` in the serialized form when present
- **AND** include `skipConditions` in the serialized form when present (omitted when unset or empty string)
- **AND** include `submitResponseMode` in the serialized form when present (omitted when unset)
- **AND** include `pluginManaged: true` in the serialized form when the job was created via `reconcileCronJobs` (omitted for user-created jobs)
- **AND** include `specKey` in the serialized form when `pluginManaged` is `true`
- **AND** include `systemActor` in the serialized form when `createdBy` is `null` (omitted for user-created jobs)
- **AND** serialize `createdBy: null` explicitly (NOT as an absent field) so the system-owned shape round-trips through JSON

#### Scenario: Channelless dynamic job round-trips

- **GIVEN** a `CronJob` with `prompt` set, `channel` absent, and `pluginManaged: true`
- **WHEN** the job is serialized and reloaded from `data/state/cron-jobs.json`
- **THEN** the reloaded record has `channel === undefined`
- **AND** all other fields are preserved

#### Scenario: Static job without channel is rejected

- **GIVEN** a request to create a `CronJob` with `staticMessage` set, `prompt` absent, and `channel` absent
- **WHEN** `createCronJob` is invoked
- **THEN** the call is rejected with an error explaining static jobs require a channel
- **AND** no row is persisted

### Requirement: Cron Job CRUD Operations

The system SHALL provide functions to create, read, update, and delete cron jobs.

#### Scenario: Create a cron job

- **WHEN** `createCronJob()` is called with valid parameters
- **THEN** the system SHALL generate a UUID, store the job, and return it
- **AND** persist to disk

#### Scenario: List cron jobs

- **WHEN** `listCronJobs()` is called
- **THEN** the system SHALL return all jobs from the in-memory cache
- **AND** optionally filter by `createdBy` or `channel`

#### Scenario: Toggle cron job

- **WHEN** `toggleCronJob(id)` is called
- **THEN** the system SHALL flip the job's `enabled` flag
- **AND** persist to disk

#### Scenario: Delete cron job

- **WHEN** `deleteCronJob(id)` is called
- **THEN** the system SHALL remove the job from cache and disk

### Requirement: Tick-Based Scheduler

The system SHALL run a scheduler that checks cron expressions against the current time every 60 seconds. The scheduler SHALL only start when `config.cron.enabled` is `true`. While running, the scheduler SHALL skip any job whose `createdBy` is non-null when `config.cron.userSchedules` is `false`.

#### Scenario: Scheduler starts on boot when crons enabled

- **WHEN** the application starts
- **AND** `config.cron.enabled` is `true` (the default)
- **THEN** the system SHALL load all cron jobs from disk
- **AND** start a 60-second interval timer

#### Scenario: Scheduler does not start when crons disabled

- **WHEN** the application starts
- **AND** `config.cron.enabled` is `false`
- **THEN** the system SHALL NOT start the 60-second interval timer
- **AND** no cron job — user-created or plugin-managed — fires

#### Scenario: Scheduler stops on shutdown

- **WHEN** the application shuts down
- **THEN** the system SHALL clear the interval timer

#### Scenario: Tick evaluates all enabled jobs

- **WHEN** the 60-second tick fires
- **THEN** the system SHALL iterate all enabled jobs
- **AND** for each job, evaluate whether `cronExpression` matches the current time in the job's `timezone`
- **AND** trigger execution for matching jobs

#### Scenario: Tick skips user-created jobs when user schedules disabled

- **GIVEN** `config.cron.enabled` is `true` AND `config.cron.userSchedules` is `false`
- **WHEN** the 60-second tick fires
- **AND** a job whose `createdBy` is a non-null user ID matches the current minute
- **THEN** the scheduler SHALL skip the job
- **AND** SHALL NOT record a run entry
- **AND** plugin-managed jobs (`createdBy === null`) at the same tick SHALL still execute normally

#### Scenario: Tick runs all jobs when user schedules enabled

- **GIVEN** `config.cron.enabled` is `true` AND `config.cron.userSchedules` is `true`
- **WHEN** the 60-second tick fires
- **THEN** matching jobs execute regardless of `createdBy`

#### Scenario: Cron expression matching uses cron-parser

- **WHEN** evaluating whether a job should fire
- **THEN** the system SHALL use the `cron-parser` library to determine if the cron expression matches the current minute in the job's timezone

### Requirement: Concurrency Guard

The system SHALL prevent overlapping executions of the same cron job.

#### Scenario: Skip job if already running

- **WHEN** a tick fires for a job that is currently executing
- **THEN** the system SHALL skip that job for this tick
- **AND** log a warning

#### Scenario: Clear running flag on completion

- **WHEN** a job execution completes (success or failure)
- **THEN** the system SHALL clear the running flag for that job

### Requirement: On-Demand Cron Job Execution

The system SHALL provide a `run_scheduled_message_now` tool that fires an existing dynamic cron job immediately, with optional replay-date context and optional replacement of a prior bot post in the job's target channel.

#### Scenario: Plain run-now fires the job at current time

- **GIVEN** a dynamic cron job `J` owned by user `U`
- **WHEN** `U` invokes `run_scheduled_message_now` with `{ id: J.id }` and no other arguments
- **THEN** the system SHALL invoke the same dynamic-execution path used by the scheduler (`executeDynamicJob`) with the job's prompt, creator, channel (when set), and `triggerType: "scheduled"`
- **AND** when the job has a channel, the resulting response SHALL be posted to the job's `channel`
- **AND** when the job is channelless, no automatic top-level posting occurs — delivery is exclusively via Claude's `post_to` actions
- **AND** a new entry SHALL be appended to `job.runs[]` with `executedAt = current time`, `status` reflecting the outcome (`"success"` / `"error"` / `"skipped"`), and `responseTs` set when delivery succeeded
- **AND** the new entry SHALL NOT have a `replayOf` field (no asOf was supplied)
- **AND** `job.lastRunAt` / `job.lastRunStatus` SHALL be updated as for any other fire

#### Scenario: Run with asOf injects replay-date context

- **GIVEN** a dynamic cron job `J`
- **WHEN** an authorized user invokes `run_scheduled_message_now` with `{ id: J.id, asOf: "2026-05-08T09:00:00Z" }`
- **THEN** the system SHALL invoke `executeDynamicJob` with the supplied `asOf` value
- **AND** the run's `additionalSystemPrompt` SHALL include both the standard attribution line AND a REPLAY CONTEXT block instructing Claude to treat the effective current date as `asOf` when interpreting relative date language and filters
- **AND** the new entry appended to `job.runs[]` SHALL carry `replayOf: "2026-05-08T09:00:00Z"`

#### Scenario: asOf defaults to most recent run's executedAt

- **GIVEN** a dynamic cron job `J` whose `runs[]` is non-empty
- **WHEN** `run_scheduled_message_now` is invoked with `{ id: J.id }` and no `asOf`
- **AND** the tool's invocation context indicates the user intends a replay (e.g., a documented `replay: true` flag, OR the tool's default semantics call for asOf-fill when prior runs exist)
- **THEN** the resolution rule SHALL be: if no `asOf` is supplied by the caller, the run fires with NO asOf set (plain run-now semantics) and the new `runs[]` entry has no `replayOf` field
- **AND** filling `asOf` from the most-recent run's `executedAt` SHALL only occur when the caller explicitly opts in (the tool's documentation describes this as the "retry" usage; callers wishing to retry the last failed run pass `asOf` themselves by reading it from `get_scheduled_message_runs`)

#### Scenario: Replace a prior post

- **GIVEN** a dynamic cron job `J` with a `channel` set and at least one `runs[]` entry whose `responseTs = T1`
- **WHEN** an authorized user invokes `run_scheduled_message_now` with `{ id: J.id, replaceResponseTs: T1 }`
- **THEN** the system SHALL verify that `T1` appears in `J.runs[].responseTs` for some prior run (implicit Clack-ownership check)
- **AND** the system SHALL call `chat.delete` on `(J.channel, T1)` BEFORE firing the new run
- **AND** the new run SHALL fire as for plain run-now (or replay, if `asOf` was also supplied)
- **AND** the tool's result SHALL include `replacedPriorPost: true` when the delete succeeded, or `replacedPriorPost: false` with a `replaceError` field when the delete failed (e.g., `message_not_found`)
- **AND** a failed delete SHALL NOT abort the fire — the new run proceeds regardless

#### Scenario: Replace on channelless job is rejected

- **GIVEN** a channelless dynamic cron job `J` (no `channel` set)
- **WHEN** an authorized user invokes `run_scheduled_message_now` with `{ id: J.id, replaceResponseTs: T1 }`
- **THEN** the tool SHALL return an error explaining that `replaceResponseTs` is not supported for channelless jobs because the prior post's channel is not statically known on the job record
- **AND** no delete SHALL be attempted
- **AND** no run SHALL be fired

#### Scenario: Replace with unowned responseTs is rejected

- **GIVEN** a dynamic cron job `J`
- **WHEN** an authorized user invokes `run_scheduled_message_now` with `{ id: J.id, replaceResponseTs: T2 }` where `T2` does NOT appear in any `J.runs[].responseTs`
- **THEN** the tool SHALL return an error explaining that the supplied `replaceResponseTs` does not belong to this job
- **AND** no delete SHALL be attempted
- **AND** no run SHALL be fired

#### Scenario: Permission — creator can run own job

- **GIVEN** a dynamic cron job `J` with `createdBy = U`
- **WHEN** user `U` (with any role) invokes `run_scheduled_message_now` with `{ id: J.id }`
- **THEN** the tool SHALL accept the call

#### Scenario: Permission — admin can run any job

- **GIVEN** a dynamic cron job `J` created by some user `Other`
- **WHEN** an admin user `A` invokes `run_scheduled_message_now` with `{ id: J.id }`
- **THEN** the tool SHALL accept the call

#### Scenario: Permission — non-admin non-creator is rejected

- **GIVEN** a dynamic cron job `J` created by user `Other`
- **WHEN** a non-admin user `U` (where `U !== Other`) invokes `run_scheduled_message_now` with `{ id: J.id }`
- **THEN** the tool SHALL return an error explaining only the creator or an admin can run this scheduled message
- **AND** no run SHALL be fired

#### Scenario: Job not found

- **WHEN** `run_scheduled_message_now` is invoked with `{ id: "nonexistent" }`
- **THEN** the tool SHALL return an error indicating the scheduled message was not found
- **AND** no run SHALL be fired

#### Scenario: Job has no prompt (static-only)

- **GIVEN** a cron job `J` with a `staticMessage` field but no `prompt`
- **WHEN** `run_scheduled_message_now` is invoked with `{ id: J.id }`
- **THEN** the tool SHALL return an error explaining that on-demand execution is only supported for dynamic (prompt-based) cron jobs
- **AND** no run SHALL be fired

#### Scenario: Configuration gate

- **WHEN** `allowScheduledMessages` is not set or is `false` in `config.json`
- **THEN** the tool server SHALL NOT register `run_scheduled_message_now`

#### Scenario: No Slack client available

- **WHEN** `allowScheduledMessages` is `true` but no Slack client is available in the tool context
- **THEN** the tool server SHALL NOT register `run_scheduled_message_now`

### Requirement: Cron Job Execution

The system SHALL execute cron jobs through the standard `processMessage` pipeline.

#### Scenario: Dynamic job execution

- **WHEN** a job with a `prompt` field fires
- **THEN** the system SHALL invoke `processMessage` with `triggerType: "scheduled"`, the resolved actor's `userId` (or a synthetic placeholder when the actor is system — never a plugin-name string), the target `channelId` (when set on the job — omitted for channelless jobs), and the `prompt` as `messageText`
- **AND** pass `silentThinking: true` to suppress streaming UX
- **AND** compute effective `requiredTools` as the union of (a) the job's explicit `requiredTools`, (b) the declared scheduled-run defaults of the plugin named in the job's `plugin` field (if any and the plugin is loaded). Pass the union as `ProcessMessageParams.requiredTools`
- **AND** propagate the job's `skipConditions` (when set) into the session so the prompt builder injects the pre-check instructions and the tool server exposes `skip_response` on `submit_response`
- **AND** when the job has a channel, the response SHALL be posted as a top-level message in the target channel (no `thread_ts`)
- **AND** when the job is channelless, no automatic top-level posting occurs — delivery is exclusively via Claude's `post_to` action calls (or no delivery at all on `skip_response: true`)

#### Scenario: Dynamic job execution with asOf (replay)

- **WHEN** `executeDynamicJob` is invoked with an `asOf: Date` argument (from `run_scheduled_message_now`)
- **THEN** the system SHALL include a REPLAY CONTEXT block in the `additionalSystemPrompt` passed to `processMessage`
- **AND** the REPLAY CONTEXT block SHALL instruct Claude to treat the effective current date as `asOf` when interpreting relative date language ("today", "yesterday", "this week") and when filtering by relative dates
- **AND** the REPLAY CONTEXT block SHALL be appended to (NOT replace) the standard attribution line
- **AND** the system SHALL NOT alter `messageTs`, `executedAt`, or the `CURRENT DATE` line of the system prompt — only the additional system prompt carries the override
- **AND** `requiredTools` SHALL still apply (the operator's tool obligations are not suspended for replays)
- **AND** `skipConditions` SHALL still evaluate against present-time external state (not asOf state) — this limitation is documented in `data/default_configuration/user/scheduling.md`
- **AND** channelless replays follow the channelless execution path (delivery via `post_to` or none)

#### Scenario: Static job execution

- **WHEN** a job with a `staticMessage` field (and no `prompt`) fires
- **THEN** the system SHALL post the `staticMessage` directly via `chat.postMessage` to the target channel
- **AND** `requiredTools` is ignored for static jobs (no Claude session exists to gate)
- **AND** `skipConditions` is ignored for static jobs (no Claude session exists to evaluate them)
- **AND** no Claude session is created

#### Scenario: User-created job runs as creator

- **WHEN** a dynamic job with a non-null `createdBy` executes
- **THEN** the Claude session SHALL use the creator's role (resolved via `getRole(createdBy)`) and repo access
- **AND** have access to all query tools appropriate for the creator's role

#### Scenario: System-owned job runs as system

- **WHEN** a dynamic job with `createdBy: null` and `systemActor` set executes
- **THEN** the Claude session SHALL run with role `"system"` (see the `user-roles` capability)
- **AND** all plugin tools whose `minRole` is `"owner"` or lower SHALL be present in the catalog
- **AND** tool gating via `meetsMinimumRole` SHALL admit every tier
- **AND** the job's declared `requiredTools` SHALL therefore be satisfiable

#### Scenario: One-shot job cleanup

- **WHEN** a job with `oneShot: true` completes successfully (whether fired by scheduler tick or by `run_scheduled_message_now`)
- **THEN** the system SHALL delete the job from storage

#### Scenario: One-shot job skipped

- **WHEN** a job with `oneShot: true` completes with a skipped response (whether fired by scheduler tick or by `run_scheduled_message_now`)
- **THEN** the system SHALL delete the job from storage (a skip still counts as the job's one chance to fire)

#### Scenario: Required tool not called during dynamic run

- **GIVEN** a dynamic job with `requiredTools: ["mcp__trivia__submit_answers"]`
- **WHEN** the job fires and Claude calls `submit_response` without having called `mcp__trivia__submit_answers`
- **THEN** `submit_response` returns an error to Claude identifying the missing tool
- **AND** Claude is expected to call the missing tool and retry `submit_response`
- **AND** the run proceeds through the normal session lifecycle (not forcibly failed by the cron scheduler)

#### Scenario: Skipped dynamic run posts nothing

- **GIVEN** a dynamic job with a non-empty `skipConditions` field
- **WHEN** the job fires and Claude calls `submit_response` with `skip_response: true` and the required acknowledgment
- **THEN** the cron scheduler SHALL NOT post any message to the target channel
- **AND** the job's `lastRunStatus` SHALL be set to `"skipped"` (replacing any prior `"success"` or `"error"` value)
- **AND** the latest entry appended to the job's `runs` history SHALL have `status: "skipped"` with no `responseTs`
- **AND** subsequent reads of the job (Home Tab rendering, `list_scheduled_messages`) SHALL reflect `"skipped"` as the most recent status — a prior `"error"` warning indicator SHALL NOT persist once a skipped run has occurred

#### Scenario: Channelless dynamic run with post_to delivers

- **GIVEN** a channelless dynamic job (no `channel` set)
- **WHEN** the job fires and Claude calls `post_to({ channel: "C123", text: "..." })` followed by `submit_response({ skip_response: true })`
- **THEN** the `post_to` action posts the message to `C123` as a top-level message
- **AND** the job's `lastRunStatus` SHALL be `"success"`
- **AND** the latest `runs[]` entry SHALL include `responseTs` set to the `post_to` message's timestamp

#### Scenario: Channelless dynamic run without post_to is a legitimate skip

- **GIVEN** a channelless dynamic job (no `channel` set)
- **WHEN** the job fires and Claude calls `submit_response({ skip_response: true })` without any prior `post_to`
- **THEN** no message is posted anywhere
- **AND** the job's `lastRunStatus` SHALL be `"skipped"`
- **AND** the latest `runs[]` entry SHALL have `status: "skipped"` with no `responseTs`
- **AND** no DM-to-creator-or-owner error notification SHALL be triggered (skip is not a failure)

#### Scenario: Message attribution

- **WHEN** a user-created cron job (`createdBy` non-null) posts a message (static or dynamic)
- **THEN** the message SHALL include attribution indicating the schedule and creator (e.g., "Scheduled by <@userId> -- Daily at 9:00 AM ET")

#### Scenario: System job attribution

- **WHEN** a system-owned cron job (`createdBy: null`) posts a message
- **THEN** the message SHALL include attribution indicating the schedule and the system actor source (e.g., "Scheduled by System (plugin: trivia) -- Daily at 9:00 AM ET")
- **AND** the attribution SHALL NOT render an `<@…>` mention for a non-user value

#### Scenario: Run history entry includes replayOf when fired with asOf

- **GIVEN** any `executeDynamicJob` invocation with a non-null `asOf` argument
- **WHEN** the run completes (success, error, or skipped)
- **THEN** the entry appended to `job.runs[]` SHALL include `replayOf: <asOf as ISO string>` in addition to the standard `executedAt` / `status` / optional `responseTs` fields
- **AND** when `asOf` is absent, the entry SHALL NOT include a `replayOf` field

### Requirement: Error Handling

The system SHALL notify the responsible human on execution failure without retrying on the same tick.

#### Scenario: Execution failure notification for user-created job

- **WHEN** a cron job with a non-null `createdBy` fails to execute
- **THEN** the system SHALL send a DM to `createdBy` with the job name, target channel, and error message
- **AND** update the job's `lastRunStatus` to `"error"`
- **AND** the job SHALL remain enabled

#### Scenario: Execution failure notification for system-owned job

- **GIVEN** a cron job with `createdBy: null` and a `systemActor` value (e.g. `"plugin:trivia"`)
- **WHEN** the job fails to execute
- **THEN** the system SHALL send a DM to the deployment owner (the user identified by `roles.owner`) instead of attempting to DM the plugin name
- **AND** the DM text SHALL identify the failed job by its `systemActor` source and `specKey` so the owner can locate it without a user mention
- **AND** if no owner is currently configured, the failure SHALL be logged at `error` level and the DM step SHALL be skipped (no exception thrown)
- **AND** the job's `lastRunStatus` SHALL be updated to `"error"`
- **AND** the job SHALL remain enabled

#### Scenario: No same-tick retry

- **WHEN** a cron job fails
- **THEN** the system SHALL NOT retry execution on the same tick
- **AND** the job SHALL be eligible for execution on the next matching tick

#### Scenario: Static job failure for user-created job

- **WHEN** a static message post fails (e.g., bot not in channel) for a job with a non-null `createdBy`
- **THEN** the system SHALL DM `createdBy` with the error
- **AND** update the job's `lastRunStatus` to `"error"`

#### Scenario: Static job failure for system-owned job

- **WHEN** a static message post fails for a job with `createdBy: null`
- **THEN** the system SHALL escalate to the deployment owner via the same path as a dynamic system-job failure
- **AND** update the job's `lastRunStatus` to `"error"`

#### Scenario: Skip is not a failure

- **WHEN** a dynamic job completes with a skipped response
- **THEN** the system SHALL NOT DM anyone (creator or owner)
- **AND** the job's `lastRunStatus` SHALL be `"skipped"` (not `"error"`)

### Requirement: Skip Conditions Field

The system SHALL support an optional free-form `skipConditions` string on cron jobs that lets scheduled runs decline posting when operator-defined conditions apply.

#### Scenario: Create with skipConditions

- **WHEN** a cron job is created with a non-empty `skipConditions` string
- **THEN** the field is stored on the cron job record verbatim
- **AND** the field is included when the job is serialized to disk

#### Scenario: Create without skipConditions

- **WHEN** a cron job is created without `skipConditions` (field omitted or empty string)
- **THEN** the stored cron job has no `skipConditions` field
- **AND** the run fires exactly as before (skip is unavailable)

#### Scenario: Update sets skipConditions

- **WHEN** `updateJob` is called with a non-empty `skipConditions` string
- **THEN** the field is stored on the cron job record verbatim
- **AND** subsequent runs use the new value

#### Scenario: Update clears skipConditions

- **WHEN** `updateJob` is called with `skipConditions: ""` (empty string)
- **THEN** the field is removed from the cron job record
- **AND** subsequent runs have skip unavailable again

#### Scenario: Update leaves skipConditions unchanged

- **WHEN** `updateJob` is called without `skipConditions` in the parameters (undefined)
- **THEN** the stored field is left unchanged

### Requirement: Cron Job Skip Dates

A `CronJob` MAY optionally carry a `skipDates: SkipDate[]` field. When set, the scheduler SHALL deterministically skip the run on any matching date — no Claude session is opened, and no tokens are spent.

```ts
interface SkipDate {
  /** Either YYYY-MM-DD (exact date) or MM-DD (recurring annually). Interpreted in the job's timezone. */
  date: string;
  /** Human-readable label used in logs. Required, non-empty. */
  label: string;
}
```

The matcher SHALL format the comparison time in `job.timezone` as both `YYYY-MM-DD` and `MM-DD` and SHALL match an entry whose `date` equals either representation. First match wins.

A skipped fire SHALL:

- Update `lastRunAt` to the matched run time (preventing same-minute double-fire).
- Append a `runs[]` entry with `status: "skipped"` (no `responseTs`).
- Log an `info` line identifying the job and the matched label (e.g. `Cron job <id> skipped by skipDates (Christmas)`).
- Honor `oneShot` deletion semantics the same as a `skipConditions` skip — a skipped off-day still counts as the one-shot's chance to fire.
- NOT invoke `processMessage` (no Claude session is created).

`skipDates` SHALL be evaluated BEFORE `skipConditions`. When both are set and a `skipDates` entry matches, the `skipConditions` path is never reached.

#### Scenario: skipDates field is optional

- **GIVEN** a `CronJob` with no `skipDates` field
- **WHEN** the scheduler tick fires it
- **THEN** the run proceeds normally (matching pre-change behavior)

#### Scenario: Exact-date match skips without Claude

- **GIVEN** a `CronJob` with `timezone: "America/Montreal"` and `skipDates: [{ date: "2026-12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires the job at `2026-12-25T09:00 America/Montreal`
- **THEN** `processMessage` is NOT called
- **AND** the job's `lastRunAt` is set to the fire time
- **AND** a `runs[]` entry is appended with `status: "skipped"` and no `responseTs`
- **AND** an info log mentions the matched label `"Christmas"`

#### Scenario: Recurring MM-DD match skips

- **GIVEN** a `CronJob` with `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires it on any year's December 25 in the job's timezone
- **THEN** the run is skipped (same bookkeeping as the exact-date scenario)

#### Scenario: skipDates evaluated in job timezone

- **GIVEN** a `CronJob` with `timezone: "Australia/Sydney"` and `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires it at a moment that is `2026-12-24T20:00Z` (which is `2026-12-25T07:00 Sydney`)
- **THEN** the run is skipped — the date check uses the Sydney calendar

#### Scenario: Non-matching date fires normally

- **GIVEN** a `CronJob` with `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires it on any date other than December 25 in `job.timezone`
- **THEN** the run proceeds normally — `processMessage` is called, the standard outcome flow applies

#### Scenario: skipDates takes precedence over skipConditions

- **GIVEN** a `CronJob` with both `skipDates: [{ date: "12-25", label: "Christmas" }]` and `skipConditions: "Skip if no games yesterday."`
- **WHEN** the scheduler fires it on December 25 in `job.timezone`
- **THEN** the run is skipped via the `skipDates` gate
- **AND** no Claude session is opened (the `skipConditions` evaluation never runs)

#### Scenario: One-shot job skipped on an off-day is still deleted

- **GIVEN** a `CronJob` with `oneShot: true` and `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** the scheduler fires it on December 25
- **THEN** the run is recorded as `status: "skipped"`
- **AND** the job is deleted from storage (mirroring the existing one-shot-skipped behavior for `skipConditions`)

#### Scenario: Replay respects skipDates against the replay date

- **GIVEN** a `CronJob` with `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** `run_scheduled_message_now` is invoked with `asOf: "2026-12-25T09:00 America/Montreal"`
- **THEN** the replay is skipped — the date check uses `asOf`, not the current time
- **AND** the appended `runs[]` entry records `replayOf` as documented for skipped replays in the existing scheduled-messages spec

#### Scenario: Invalid skipDates entries are tolerated at runtime

- **GIVEN** a `CronJob` whose `skipDates` somehow contains an entry with a malformed `date` (e.g. surviving a hand-edit to the JSON file)
- **WHEN** the scheduler evaluates the gate
- **THEN** the malformed entry does NOT match any date (the comparison naturally fails)
- **AND** the run proceeds based on the remaining entries' matching status — no crash, no hard error

### Requirement: SkipDates Serialization

`CronJob` serialization (load/save of `cron-jobs.json`) SHALL preserve the `skipDates` field round-trip when present, and SHALL omit it from the serialized form when absent or empty. Pre-existing jobs without `skipDates` SHALL load normally (field defaults to absent).

#### Scenario: skipDates round-trips through persistence

- **GIVEN** a `CronJob` with `skipDates: [{ date: "12-25", label: "Christmas" }]` saved to `cron-jobs.json`
- **WHEN** the scheduler reloads jobs from disk
- **THEN** the reloaded job has the same `skipDates` array

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

### Requirement: Cron Job Jitter Field

The `CronJob` data model SHALL support an OPTIONAL `jitterMinutes` field (a non-negative integer). When present, it declares the maximum number of minutes a job's effective fire may be delayed past its canonical cron slot. The field SHALL be additive and backward-compatible: jobs that omit it behave identically to pre-jitter behavior.

#### Scenario: Jitter field round-trips through persistence

- **WHEN** a cron job with `jitterMinutes: 7` is created
- **THEN** the serialized form in `data/state/cron-jobs.json` SHALL include `jitterMinutes: 7`
- **AND** reloading the job from disk SHALL restore `jitterMinutes === 7`

#### Scenario: Jitter omitted when unset

- **WHEN** a cron job is created without a `jitterMinutes` value
- **THEN** the serialized form SHALL omit the `jitterMinutes` key
- **AND** the reloaded job SHALL have `jitterMinutes === undefined`

#### Scenario: Legacy rows without jitter load unchanged

- **GIVEN** a persisted cron job with no `jitterMinutes` key (any pre-jitter row)
- **WHEN** the job is loaded
- **THEN** it SHALL load normally with `jitterMinutes === undefined`
- **AND** no migration SHALL be required

#### Scenario: Jitter value is validated

- **WHEN** a `jitterMinutes` value is supplied that is negative, non-integer, or greater than 30
- **THEN** the boundary that accepts the value (spec validation / create path) SHALL reject or skip it with a logged reason
- **AND** a value in the inclusive range `[0, 30]` SHALL be accepted

### Requirement: Jittered Match-Window Offset

When a job carries a non-zero `jitterMinutes`, the Tick-Based Scheduler SHALL shift the 60-second match window forward by a deterministic per-occurrence offset rather than matching the canonical cron slot directly. The canonical `cronExpression` SHALL NOT be modified — jitter applies only to the match computation. A job with `jitterMinutes` absent or `0` SHALL match exactly as it does today.

#### Scenario: Effective fire is delayed by a forward offset

- **GIVEN** a job whose canonical slot is `14:15:00` and `jitterMinutes` is `8`
- **WHEN** the scheduler evaluates the job
- **THEN** it SHALL compute `effectivePrev = canonicalSlot + offset` where `offset` is in the inclusive-exclusive range `[0, 8 minutes)`
- **AND** the job SHALL match only when `now` is within the 60-second window `[effectivePrev, effectivePrev + 60s)`

#### Scenario: Offset is deterministic across ticks within one occurrence

- **GIVEN** a job with `jitterMinutes` set and a fixed canonical slot
- **WHEN** the offset is computed on multiple ticks within that occurrence (different `now` values)
- **THEN** every computation SHALL yield the identical offset
- **AND** therefore exactly one tick within the inter-fire gap SHALL match the job (no multi-fire, no missed fire)

#### Scenario: Offset varies between occurrences

- **GIVEN** a job with `jitterMinutes` set
- **WHEN** the offset is computed for two distinct canonical slots (different occurrences of the same job)
- **THEN** the offsets MAY differ
- **AND** the offset SHALL be a pure function of the job's identity and the canonical occurrence time (no dependence on `Math.random` or wall-clock at call time)

#### Scenario: Double-fire guard holds under jitter

- **GIVEN** a job with `jitterMinutes` set that has already fired for the current occurrence (its `lastRunAt` reflects the jittered fire time)
- **WHEN** a subsequent tick within the same occurrence evaluates the job
- **THEN** the guard SHALL compare `lastRunAt` against `effectivePrev` and SHALL NOT re-fire the same occurrence
- **AND** the next occurrence's canonical slot SHALL still be eligible to fire

#### Scenario: Canonical expression is preserved for display

- **GIVEN** a job with `jitterMinutes` set
- **WHEN** the job's `cronExpression` is read for Home Tab description or inspection
- **THEN** it SHALL return the unmodified canonical expression
- **AND** the jitter offset SHALL NOT appear in or alter the stored expression
