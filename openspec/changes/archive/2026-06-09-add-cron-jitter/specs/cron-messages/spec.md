## ADDED Requirements

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
