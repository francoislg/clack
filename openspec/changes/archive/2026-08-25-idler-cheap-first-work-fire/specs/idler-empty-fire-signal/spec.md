## ADDED Requirements

### Requirement: Breaker state file with graceful reader

The idler SHALL persist a machine-readable empty-fire record at `data/plugins/idler/breaker.json` (plugin-scoped I/O via `sdk.readFile`/`sdk.writeFile`) with the shape `{ windowKey: string, consecutiveEmpty: number, pendingAsync: string[] }`. The reader SHALL be graceful per persisted-state convention: an absent or invalid file yields the zero state `{ windowKey: "", consecutiveEmpty: 0, pendingAsync: [] }` and never throws. The `pendingAsync` field SHALL be present in every write (this change always writes `[]`); it is the forward contract consumed by the night circuit breaker, declared now so the file shape never migrates.

#### Scenario: Absent file reads as zero state

- **WHEN** the breaker state is read and `breaker.json` does not exist
- **THEN** the zero state `{ windowKey: "", consecutiveEmpty: 0, pendingAsync: [] }` is returned without error

#### Scenario: Corrupt file reads as zero state

- **GIVEN** `breaker.json` contains invalid JSON or a mismatched shape
- **WHEN** the breaker state is read
- **THEN** the zero state is returned and no exception propagates to the caller

### Requirement: Window-keyed consecutive-empty counter

The empty-fire counter SHALL be keyed by `windowKey` — the YYYY-MM-DD date, rendered in the work window's timezone, of the day the current work window OPENED. For an overnight window (`start > end`), fires at hours before `end` SHALL key to the previous calendar day. Recording an empty fire SHALL compare the stored `windowKey` against the current one: on a match, `consecutiveEmpty` increments by 1; on a mismatch, the state resets to `{ windowKey: current, consecutiveEmpty: 1, pendingAsync: [] }` — a new window's first empty fire counts as 1, and stale prior-night state never leaks forward.

#### Scenario: Same-window empty fires accumulate

- **GIVEN** stored state `{ windowKey: "2026-08-24", consecutiveEmpty: 1 }` and the current window opened on 2026-08-24
- **WHEN** an empty fire is recorded
- **THEN** the stored state becomes `consecutiveEmpty: 2` with the same `windowKey`

#### Scenario: Window rollover resets before counting

- **GIVEN** stored state from a previous window day
- **WHEN** an empty fire is recorded in a newly-opened window
- **THEN** the state becomes `{ windowKey: <new date>, consecutiveEmpty: 1, pendingAsync: [] }`

#### Scenario: Post-midnight fire keys to the window's opening date

- **GIVEN** an overnight work window `18 → 9`
- **WHEN** an empty fire is recorded at 02:00 local time on 2026-08-25
- **THEN** its `windowKey` is `2026-08-24` — the date the window opened

### Requirement: Work fire records the empty outcome

The idler SHALL register an always-on `record_fire_outcome` tool (admin-gated like its sibling ledger tools) accepting `{ outcome: "empty" }`, which applies the window-keyed increment. The work prompt SHALL instruct Claude to call it exactly when a work fire ends with no fresh work, immediately before ending the fire via skip. The tool SHALL NOT be listed in the work spec's `requiredTools` — it is conditional, and forcing it would fabricate calls on productive fires.

#### Scenario: Empty fire increments via the tool

- **GIVEN** a work fire whose ledger shows no fresh unit
- **WHEN** Claude calls `record_fire_outcome({ outcome: "empty" })` and ends the fire
- **THEN** `consecutiveEmpty` for the current window has increased by 1

#### Scenario: Productive fires never call the tool

- **GIVEN** a work fire that advanced a unit
- **WHEN** the fire completes
- **THEN** `record_fire_outcome` is not called and `requiredTools` does not force it

### Requirement: Productive activity resets the counter in code

The `record_activity` tool handler SHALL reset `consecutiveEmpty` to 0 for every activity kind EXCEPT `parked`. Parking records the disposal of a stale unit — the fire found nothing fresh, so it must not reset. The `failure` kind SHALL reset: a failed attempt proves fresh work exists and the signal must not accumulate toward a stop while a unit is retrying. The reset is code-level (inside the handler), never dependent on prompt cooperation.

#### Scenario: Opening a PR resets the counter

- **GIVEN** stored `consecutiveEmpty: 2`
- **WHEN** `record_activity` is called with kind `pr_opened`
- **THEN** the stored `consecutiveEmpty` becomes 0

#### Scenario: Parking does not reset

- **GIVEN** stored `consecutiveEmpty: 2`
- **WHEN** `record_activity` is called with kind `parked`
- **THEN** the stored `consecutiveEmpty` remains 2

#### Scenario: A failed attempt resets

- **GIVEN** stored `consecutiveEmpty: 2`
- **WHEN** `record_activity` is called with kind `failure`
- **THEN** the stored `consecutiveEmpty` becomes 0
