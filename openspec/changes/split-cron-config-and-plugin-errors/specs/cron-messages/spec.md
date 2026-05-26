## MODIFIED Requirements

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
