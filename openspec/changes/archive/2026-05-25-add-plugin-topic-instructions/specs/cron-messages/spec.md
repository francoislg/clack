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
- **AND** optionally `attachedTopics` (string array of topic names that SHALL be pre-attached to the Claude session when this job fires — see the `plugin-topic-instructions` capability. Present only when a plugin declared the field via `reconcileCronJobs`)

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
- **AND** jobs without an `attachedTopics` field load normally (field is optional and defaults to absent / empty)
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
- **AND** include `attachedTopics` in the serialized form when the array is non-empty (omitted when unset or empty)
- **AND** serialize `createdBy: null` explicitly (NOT as an absent field) so the system-owned shape round-trips through JSON

### Requirement: Cron Job Execution

The system SHALL execute cron jobs through the standard `processMessage` pipeline.

#### Scenario: Dynamic job execution

- **WHEN** a job with a `prompt` field fires
- **THEN** the system SHALL invoke `processMessage` with `triggerType: "scheduled"`, the resolved actor's `userId` (or a synthetic placeholder when the actor is system — never a plugin-name string), the target `channelId`, and the `prompt` as `messageText`
- **AND** pass `silentThinking: true` to suppress streaming UX
- **AND** compute effective `requiredTools` as the union of (a) the job's explicit `requiredTools`, (b) the declared scheduled-run defaults of the plugin named in the job's `plugin` field (if any and the plugin is loaded). Pass the union as `ProcessMessageParams.requiredTools`
- **AND** propagate the job's `skipConditions` (when set) into the session so the prompt builder injects the pre-check instructions and the tool server exposes `skip_response` on `submit_response`
- **AND** propagate the job's `attachedTopics` (when set and non-empty) into the session as pre-attached topics so the system prompt for every turn includes the resolved topic sections — see the `plugin-topic-instructions` capability for resolution semantics
- **AND** the response SHALL be posted as a top-level message in the target channel (no `thread_ts`)

#### Scenario: Dynamic job execution with asOf (replay)

- **WHEN** `executeDynamicJob` is invoked with an `asOf: Date` argument (from `run_scheduled_message_now`)
- **THEN** the system SHALL include a REPLAY CONTEXT block in the `additionalSystemPrompt` passed to `processMessage`
- **AND** the REPLAY CONTEXT block SHALL instruct Claude to treat the effective current date as `asOf` when interpreting relative date language ("today", "yesterday", "this week") and when filtering by relative dates
- **AND** the REPLAY CONTEXT block SHALL be appended to (NOT replace) the standard attribution line
- **AND** the system SHALL NOT alter `messageTs`, `executedAt`, or the `CURRENT DATE` line of the system prompt — only the additional system prompt carries the override
- **AND** `requiredTools` SHALL still apply (the operator's tool obligations are not suspended for replays)
- **AND** `attachedTopics` SHALL still apply (a replay sees the same pre-attached topics as a live fire)
- **AND** `skipConditions` SHALL still evaluate against present-time external state (not asOf state) — this limitation is documented in `data/default_configuration/user/scheduling.md`

#### Scenario: Static job execution

- **WHEN** a job with a `staticMessage` field (and no `prompt`) fires
- **THEN** the system SHALL post the `staticMessage` directly via `chat.postMessage` to the target channel
- **AND** `requiredTools` is ignored for static jobs (no Claude session exists to gate)
- **AND** `skipConditions` is ignored for static jobs (no Claude session exists to evaluate them)
- **AND** `attachedTopics` is ignored for static jobs (no Claude session exists to attach topics into)
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
