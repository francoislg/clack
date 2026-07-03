# cron-catch-up

## ADDED Requirements

### Requirement: Delayed-Boot Hook Registration

The plugin SDK SHALL expose an `onDelayedBoot(handler)` member that registers an async handler to be invoked once per process boot, after the configured catch-up delay. Registration SHALL be available during plugin init (before the cron scheduler starts). Multiple plugins MAY each register a handler; a plugin registering more than once SHALL have each registered handler invoked.

#### Scenario: Handler registered during plugin init is invoked after boot

- **WHEN** a plugin calls `sdk.onDelayedBoot(handler)` during its init
- **AND** the process finishes booting and the cron scheduler starts
- **THEN** the handler SHALL be invoked exactly once, `cron.catchUp.delayMinutes` minutes after the scheduler start
- **AND** the handler SHALL be invoked on every subsequent boot as well (the hook is unconditional — it does not depend on any fires having been missed)

#### Scenario: Handlers run sequentially and errors are isolated

- **WHEN** two plugins have each registered a delayed-boot handler and the first handler throws
- **THEN** the dispatch SHALL log the error and continue to the second handler
- **AND** handlers SHALL be awaited sequentially in registration order (no concurrent dispatch)

#### Scenario: Dispatch timer follows the scheduler lifecycle

- **WHEN** the cron scheduler is stopped before the delay elapses (shutdown or soft restart)
- **THEN** the pending dispatch timer SHALL be cancelled
- **AND** a subsequent scheduler start SHALL arm a fresh dispatch timer

### Requirement: Catch-Up Delay Configuration

The system SHALL read an optional `cron.catchUp.delayMinutes` config value (fail-fast zod validation at boot: integer ≥ 0) controlling the delay between cron-scheduler start and delayed-boot dispatch. When absent, the delay SHALL default to 3 minutes.

#### Scenario: Default delay

- **WHEN** `config.json` has no `cron.catchUp` block
- **THEN** delayed-boot handlers SHALL be dispatched 3 minutes after the cron scheduler starts

#### Scenario: Invalid delay rejected at boot

- **WHEN** `config.json` contains `cron.catchUp.delayMinutes: -1` (or a non-integer)
- **THEN** boot SHALL fail with a formatted zod validation error naming the offending path

#### Scenario: Zero delay dispatches immediately

- **WHEN** `config.json` contains `cron.catchUp.delayMinutes: 0`
- **THEN** delayed-boot handlers SHALL be dispatched on the next event-loop tick after the cron scheduler starts (no waiting period)

### Requirement: Missed-Run Query

The plugin SDK SHALL expose a `missedRuns(specKey)` member returning `{ lastExpectedRuns: Date[] }` — the cron occurrences of the identified job that were expected but never started. Occurrences SHALL be computed against the job's `cronExpression` in the job's `timezone` using canonical (non-jittered) slot times, over the range from `max(lastRunAt ?? createdAt, now − 14 days)` to now, excluding any occurrence at or before `lastRunAt`, and capped at 100 entries. The query SHALL be owner-scoped: `specKey` resolves only within the calling plugin's own reconciled jobs (`plugin === ownerKey`, `pluginManaged === true`).

#### Scenario: Missed slot detected after downtime

- **WHEN** a plugin-managed job with a daily 10:00 cron last ran yesterday at 10:00 and the process was down today from 09:50 to 10:30
- **AND** the plugin calls `sdk.missedRuns` for that job's specKey after boot
- **THEN** the result SHALL contain exactly one entry: today's 10:00 occurrence

#### Scenario: No missed runs when the slot fired

- **WHEN** the job's most recent cron occurrence started normally (its `lastRunAt` is at or after that occurrence)
- **THEN** `lastExpectedRuns` SHALL be empty

#### Scenario: Disabled job reports no missed runs

- **WHEN** the identified job has `enabled: false`
- **THEN** `lastExpectedRuns` SHALL be empty (an intentionally-off job has no missed fires)

#### Scenario: Never-run job is bounded by lookback

- **WHEN** a job has no `lastRunAt` and was created 60 days ago with an hourly cron
- **THEN** the computation SHALL consider only occurrences within the last 14 days and return at most 100 entries

#### Scenario: Unknown or foreign specKey is an error

- **WHEN** a plugin calls `sdk.missedRuns` with a specKey that does not resolve within its own reconciled jobs (unknown, or owned by another plugin)
- **THEN** the call SHALL reject with an error naming the specKey (it SHALL NOT return another owner's job data)

#### Scenario: Invalid cron expression or timezone yields no missed runs

- **WHEN** the identified job carries an unparseable `cronExpression` or an invalid `timezone`
- **THEN** the computation SHALL log the error and return an empty `lastExpectedRuns` list rather than throwing (mirroring `matchesCron`'s log-and-return-false handling)

### Requirement: Owner-Scoped Fire-Now

The plugin SDK SHALL expose a `runCronJobNow(specKey)` member that immediately executes the identified job as a plain run — with NO `asOf` replay semantics — routed through the scheduler's `executeJob` path so that the `skipDates` gate (evaluated against the current date), the running-jobs concurrency guard, `markJobStarted` double-fire protection, and run-history recording all apply. The call SHALL be owner-scoped identically to `missedRuns` and SHALL await run completion.

#### Scenario: Catch-up fire is a plain run

- **WHEN** a plugin calls `sdk.runCronJobNow` for one of its own jobs
- **THEN** the job SHALL execute through `executeJob` with no `asOf` argument
- **AND** the recorded run SHALL NOT carry a `replayOf` field
- **AND** the session prompt SHALL NOT contain a REPLAY CONTEXT block

#### Scenario: Fire-now advances lastRunAt so the tick cannot double-fire

- **WHEN** a job's 10:00 slot was missed and `runCronJobNow` fires it at 10:33
- **THEN** `lastRunAt` SHALL be persisted at fire start
- **AND** subsequent scheduler ticks SHALL NOT re-fire the 10:00 slot

#### Scenario: Fire-now respects skipDates for today

- **WHEN** `runCronJobNow` is called on a job whose `skipDates` matches today's date in the job's timezone
- **THEN** the run SHALL be recorded as `skipped` and no Claude session SHALL be opened

#### Scenario: Fire-now before the scheduler has a Slack client

- **WHEN** `runCronJobNow` is called while no Slack client is available (scheduler not started)
- **THEN** the call SHALL reject with a descriptive error rather than crashing the process

#### Scenario: Fire-now with unknown or foreign specKey is an error

- **WHEN** a plugin calls `sdk.runCronJobNow` with a specKey that does not resolve within its own reconciled jobs (unknown, or owned by another plugin)
- **THEN** the call SHALL reject with an error naming the specKey and SHALL NOT execute the job
