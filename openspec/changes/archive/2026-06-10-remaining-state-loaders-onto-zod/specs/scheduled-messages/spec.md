## ADDED Requirements

### Requirement: Cron-jobs load is schema-driven

`loadJobs` SHALL parse the cron-jobs store against zod schemas (`CronJobState`/`CronJob`/`CronRun`/`SkipDate`) rather than a blind `as Partial<CronJobState>` cast plus the hand-rolled `sanitizeLoadedJobs` pass. The `submitResponseMode` field SHALL be a `z.enum`, replacing the manual enum sanitize. The contract stays graceful: a missing file, invalid JSON, or shape mismatch SHALL log and return `[]`, never throw. Legacy on-disk jobs (e.g. nameless jobs) SHALL still load.

#### Scenario: Invalid submitResponseMode is handled by the enum, not a manual sanitize

- **WHEN** a stored job carries a `submitResponseMode` value outside the allowed set
- **THEN** the schema rejects/normalizes it equivalently to the pre-migration `sanitizeLoadedJobs` behavior, with the same logged warning intent

#### Scenario: Legacy and current jobs round-trip

- **WHEN** a cron-jobs file written by a prior build (including legacy nameless jobs and populated `runs[]`/`skipDates[]`) is loaded
- **THEN** the returned `CronJob[]` is identical to the pre-migration result; a corrupt file still yields `[]`
