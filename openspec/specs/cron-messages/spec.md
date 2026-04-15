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
- **THEN** it SHALL contain: `id` (UUID), `cronExpression` (cron string), `channel` (Slack channel ID), `createdBy` (Slack user ID), `createdAt` (ISO timestamp), `enabled` (boolean), `timezone` (IANA timezone string)
- **AND** either `prompt` (string, for dynamic Claude-powered execution) or `staticMessage` (string, for direct posting), or both
- **AND** optionally `oneShot` (boolean), `repositories` (string array), `lastRunAt` (ISO timestamp), `lastRunStatus` ("success" or "error")
- **AND** optionally `requiredTools` (string array of fully-qualified MCP tool names that must be called during a dynamic run before `submit_response` will deliver)
- **AND** optionally `plugin` (name of a loaded Clack plugin the job is associated with — used to pick up the plugin's declared scheduled-run default required tools)

#### Scenario: Load jobs from disk
- **WHEN** the system starts or first accesses cron jobs
- **THEN** it SHALL load `data/state/cron-jobs.json` into an in-memory cache
- **AND** if the file does not exist, initialize with an empty jobs array
- **AND** jobs without a `requiredTools` field load normally (field is optional and defaults to absent)

#### Scenario: Persist jobs to disk
- **WHEN** a cron job is created, updated, or deleted
- **THEN** the system SHALL write the full state to `data/state/cron-jobs.json`
- **AND** update the in-memory cache atomically
- **AND** include `requiredTools` in the serialized form when present

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

The system SHALL run a scheduler that checks cron expressions against the current time every 60 seconds.

#### Scenario: Scheduler starts on boot
- **WHEN** the application starts
- **THEN** the system SHALL load all cron jobs from disk
- **AND** start a 60-second interval timer

#### Scenario: Scheduler stops on shutdown
- **WHEN** the application shuts down
- **THEN** the system SHALL clear the interval timer

#### Scenario: Tick evaluates all enabled jobs
- **WHEN** the 60-second tick fires
- **THEN** the system SHALL iterate all enabled jobs
- **AND** for each job, evaluate whether `cronExpression` matches the current time in the job's `timezone`
- **AND** trigger execution for matching jobs

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

### Requirement: Cron Job Execution

The system SHALL execute cron jobs through the standard `processMessage` pipeline.

#### Scenario: Dynamic job execution
- **WHEN** a job with a `prompt` field fires
- **THEN** the system SHALL invoke `processMessage` with `triggerType: "scheduled"`, the creator's `userId`, the target `channelId`, and the `prompt` as `messageText`
- **AND** pass `silentThinking: true` to suppress streaming UX
- **AND** compute effective `requiredTools` as the union of (a) the job's explicit `requiredTools`, (b) the declared scheduled-run defaults of the plugin named in the job's `plugin` field (if any and the plugin is loaded). Pass the union as `ProcessMessageParams.requiredTools`
- **AND** the response SHALL be posted as a top-level message in the target channel (no `thread_ts`)

#### Scenario: Static job execution
- **WHEN** a job with a `staticMessage` field (and no `prompt`) fires
- **THEN** the system SHALL post the `staticMessage` directly via `chat.postMessage` to the target channel
- **AND** `requiredTools` is ignored for static jobs (no Claude session exists to gate)
- **AND** no Claude session is created

#### Scenario: Job runs as creator
- **WHEN** a dynamic job executes
- **THEN** the Claude session SHALL use the creator's role and repo access
- **AND** have access to all query tools appropriate for the creator's role

#### Scenario: One-shot job cleanup
- **WHEN** a job with `oneShot: true` completes successfully
- **THEN** the system SHALL delete the job from storage

#### Scenario: Required tool not called during dynamic run
- **GIVEN** a dynamic job with `requiredTools: ["mcp__trivia__submit_answers"]`
- **WHEN** the job fires and Claude calls `submit_response` without having called `mcp__trivia__submit_answers`
- **THEN** `submit_response` returns an error to Claude identifying the missing tool
- **AND** Claude is expected to call the missing tool and retry `submit_response`
- **AND** the run proceeds through the normal session lifecycle (not forcibly failed by the cron scheduler)

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
