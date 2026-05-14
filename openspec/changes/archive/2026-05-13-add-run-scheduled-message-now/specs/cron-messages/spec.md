## ADDED Requirements

### Requirement: On-Demand Cron Job Execution

The system SHALL provide a `run_scheduled_message_now` tool that fires an existing dynamic cron job immediately, with optional replay-date context and optional replacement of a prior bot post in the job's target channel.

#### Scenario: Plain run-now fires the job at current time

- **GIVEN** a dynamic cron job `J` owned by user `U`
- **WHEN** `U` invokes `run_scheduled_message_now` with `{ id: J.id }` and no other arguments
- **THEN** the system SHALL invoke the same dynamic-execution path used by the scheduler (`executeDynamicJob`) with the job's prompt, creator, channel, and `triggerType: "scheduled"`
- **AND** the resulting response SHALL be posted to the job's `channel`
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

- **GIVEN** a dynamic cron job `J` with at least one `runs[]` entry whose `responseTs = T1`
- **WHEN** an authorized user invokes `run_scheduled_message_now` with `{ id: J.id, replaceResponseTs: T1 }`
- **THEN** the system SHALL verify that `T1` appears in `J.runs[].responseTs` for some prior run (implicit Clack-ownership check)
- **AND** the system SHALL call `chat.delete` on `(J.channel, T1)` BEFORE firing the new run
- **AND** the new run SHALL fire as for plain run-now (or replay, if `asOf` was also supplied)
- **AND** the tool's result SHALL include `replacedPriorPost: true` when the delete succeeded, or `replacedPriorPost: false` with a `replaceError` field when the delete failed (e.g., `message_not_found`)
- **AND** a failed delete SHALL NOT abort the fire — the new run proceeds regardless

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

## MODIFIED Requirements

### Requirement: Cron Job Execution

The system SHALL execute cron jobs through the standard `processMessage` pipeline.

#### Scenario: Dynamic job execution

- **WHEN** a job with a `prompt` field fires
- **THEN** the system SHALL invoke `processMessage` with `triggerType: "scheduled"`, the creator's `userId`, the target `channelId`, and the `prompt` as `messageText`
- **AND** pass `silentThinking: true` to suppress streaming UX
- **AND** compute effective `requiredTools` as the union of (a) the job's explicit `requiredTools`, (b) the declared scheduled-run defaults of the plugin named in the job's `plugin` field (if any and the plugin is loaded). Pass the union as `ProcessMessageParams.requiredTools`
- **AND** propagate the job's `skipConditions` (when set) into the session so the prompt builder injects the pre-check instructions and the tool server exposes `skip_response` on `submit_response`
- **AND** the response SHALL be posted as a top-level message in the target channel (no `thread_ts`)

#### Scenario: Dynamic job execution with asOf (replay)

- **WHEN** `executeDynamicJob` is invoked with an `asOf: Date` argument (from `run_scheduled_message_now`)
- **THEN** the system SHALL include a REPLAY CONTEXT block in the `additionalSystemPrompt` passed to `processMessage`
- **AND** the REPLAY CONTEXT block SHALL instruct Claude to treat the effective current date as `asOf` when interpreting relative date language ("today", "yesterday", "this week") and when filtering by relative dates
- **AND** the REPLAY CONTEXT block SHALL be appended to (NOT replace) the standard attribution line
- **AND** the system SHALL NOT alter `messageTs`, `executedAt`, or the `CURRENT DATE` line of the system prompt — only the additional system prompt carries the override
- **AND** `requiredTools` SHALL still apply (the operator's tool obligations are not suspended for replays)
- **AND** `skipConditions` SHALL still evaluate against present-time external state (not asOf state) — this limitation is documented in `data/default_configuration/user/scheduling.md`

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

- **WHEN** a cron job posts a message (static or dynamic)
- **THEN** the message SHALL include attribution indicating the schedule and creator (e.g., "Scheduled by <@userId> -- Daily at 9:00 AM ET")

#### Scenario: Run history entry includes replayOf when fired with asOf

- **GIVEN** any `executeDynamicJob` invocation with a non-null `asOf` argument
- **WHEN** the run completes (success, error, or skipped)
- **THEN** the entry appended to `job.runs[]` SHALL include `replayOf: <asOf as ISO string>` in addition to the standard `executedAt` / `status` / optional `responseTs` fields
- **AND** when `asOf` is absent, the entry SHALL NOT include a `replayOf` field
