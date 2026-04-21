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
- **AND** optionally `skipConditions` (string; when set, the scheduled run evaluates these free-form conditions and may decline delivery via `submit_response` with `skip_response: true`)

#### Scenario: Load jobs from disk
- **WHEN** the system starts or first accesses cron jobs
- **THEN** it SHALL load `data/state/cron-jobs.json` into an in-memory cache
- **AND** if the file does not exist, initialize with an empty jobs array
- **AND** jobs without a `requiredTools` field load normally (field is optional and defaults to absent)
- **AND** jobs without a `skipConditions` field load normally (field is optional and defaults to absent)

#### Scenario: Persist jobs to disk
- **WHEN** a cron job is created, updated, or deleted
- **THEN** the system SHALL write the full state to `data/state/cron-jobs.json`
- **AND** update the in-memory cache atomically
- **AND** include `requiredTools` in the serialized form when present
- **AND** include `skipConditions` in the serialized form when present (omitted when unset or empty string)

### Requirement: Cron Job Execution

The system SHALL execute cron jobs through the standard `processMessage` pipeline.

#### Scenario: Dynamic job execution
- **WHEN** a job with a `prompt` field fires
- **THEN** the system SHALL invoke `processMessage` with `triggerType: "scheduled"`, the creator's `userId`, the target `channelId`, and the `prompt` as `messageText`
- **AND** pass `silentThinking: true` to suppress streaming UX
- **AND** compute effective `requiredTools` as the union of (a) the job's explicit `requiredTools`, (b) the declared scheduled-run defaults of the plugin named in the job's `plugin` field (if any and the plugin is loaded). Pass the union as `ProcessMessageParams.requiredTools`
- **AND** propagate the job's `skipConditions` (when set) into the session so the prompt builder injects the pre-check instructions and the tool server exposes `skip_response` on `submit_response`
- **AND** the response SHALL be posted as a top-level message in the target channel (no `thread_ts`)

#### Scenario: Static job execution
- **WHEN** a job with a `staticMessage` field (and no `prompt`) fires
- **THEN** the system SHALL post the `staticMessage` directly via `chat.postMessage` to the target channel
- **AND** `requiredTools` is ignored for static jobs (no Claude session exists to gate)
- **AND** `skipConditions` is ignored for static jobs (no Claude session exists to evaluate them)
- **AND** no Claude session is created

#### Scenario: Job runs as creator
- **WHEN** a dynamic job executes
- **THEN** the Claude session SHALL use the creator's role and repo access
- **AND** have access to all query tools appropriate for the creator's role

#### Scenario: One-shot job cleanup
- **WHEN** a job with `oneShot: true` completes successfully
- **THEN** the system SHALL delete the job from storage

#### Scenario: One-shot job skipped
- **WHEN** a job with `oneShot: true` completes with a skipped response
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
- **WHEN** a cron job posts a message (static or dynamic)
- **THEN** the message SHALL include attribution indicating the schedule and creator (e.g., "Scheduled by <@userId> -- Daily at 9:00 AM ET")

### Requirement: Error Handling

The system SHALL notify the creator on execution failure without retrying on the same tick.

#### Scenario: Execution failure notification
- **WHEN** a cron job execution fails
- **THEN** the system SHALL send a DM to the creator with the job name, target channel, and error message
- **AND** update the job's `lastRunStatus` to `"error"`
- **AND** the job SHALL remain enabled

#### Scenario: No same-tick retry
- **WHEN** a cron job fails
- **THEN** the system SHALL NOT retry execution on the same tick
- **AND** the job SHALL be eligible for execution on the next matching tick

#### Scenario: Static job failure
- **WHEN** a static message post fails (e.g., bot not in channel)
- **THEN** the system SHALL DM the creator with the error
- **AND** update the job's `lastRunStatus` to `"error"`

#### Scenario: Skip is not a failure
- **WHEN** a dynamic job completes with a skipped response
- **THEN** the system SHALL NOT DM the creator
- **AND** the job's `lastRunStatus` SHALL be `"skipped"` (not `"error"`)

## ADDED Requirements

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
