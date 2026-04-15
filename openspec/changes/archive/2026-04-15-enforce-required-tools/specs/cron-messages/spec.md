## MODIFIED Requirements

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
