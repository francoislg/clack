## MODIFIED Requirements

### Requirement: Window-keyed consecutive-empty counter

The empty-fire counter SHALL be keyed by `windowKey` — the YYYY-MM-DD date, rendered in the work window's timezone, of the day the current work window OPENED. For an overnight window (`start > end`), fires at hours before `end` SHALL key to the previous calendar day. Recording an empty fire SHALL compare the stored `windowKey` against the current one: on a match, `consecutiveEmpty` increments by 1; on a mismatch, the state resets to `{ windowKey: current, consecutiveEmpty: 1, pendingAsync: [] }` — a new window's first empty fire counts as 1, and stale prior-night state never leaks forward. When `pendingAsync` is non-empty at recording time, an empty record SHALL NOT increment the counter — it freezes (without resetting), because the fire found nothing but the idler's own async output is still expected.

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

#### Scenario: Pending async freezes the counter

- **GIVEN** stored state `{ consecutiveEmpty: 1, pendingAsync: ["org/repo#123"] }` for the current window
- **WHEN** an empty fire is recorded
- **THEN** `consecutiveEmpty` remains 1 — neither incremented nor reset

## ADDED Requirements

### Requirement: Trip condition surfaced through list_top_ideas

When `stopAfterEmptyRounds > 0`, the `list_top_ideas` result SHALL include a `nightBreaker: { tripped, consecutiveEmpty, threshold }` field, evaluated at call time from live config and the stored breaker state. `tripped` SHALL be true exactly when the stored `windowKey` matches the current window AND `consecutiveEmpty >= stopAfterEmptyRounds`. When the feature is disabled (`stopAfterEmptyRounds: 0`), the field SHALL be absent. Stale state from a previous window SHALL never report tripped.

#### Scenario: Threshold reached reports tripped

- **GIVEN** `stopAfterEmptyRounds: 2` and stored `consecutiveEmpty: 2` for the current window
- **WHEN** `list_top_ideas` is called
- **THEN** the result includes `nightBreaker.tripped: true` with `consecutiveEmpty: 2` and `threshold: 2`

#### Scenario: Disabled knob omits the field

- **GIVEN** `stopAfterEmptyRounds: 0`
- **WHEN** `list_top_ideas` is called
- **THEN** the result contains no `nightBreaker` field

#### Scenario: Prior-night state never trips a new window

- **GIVEN** stored `consecutiveEmpty: 5` keyed to yesterday's window
- **WHEN** `list_top_ideas` is called during today's window
- **THEN** `nightBreaker.tripped` is false

### Requirement: Async triggers register as pending work

`record_fire_outcome` SHALL accept `outcome: "empty" | "async-triggered"`; `"async-triggered"` REQUIRES an `asyncKey` (a stable trigger identity such as `"org/repo#123"`) and adds it to `pendingAsync` with set semantics (no duplicates). Recording an async trigger SHALL NOT increment `consecutiveEmpty`. `pendingAsync` SHALL be cleared by (a) the code-level productive reset — a productive fire means the async loop advanced — and (b) window rollover, so a trigger whose output never arrives blocks the breaker for at most one night.

#### Scenario: Posting a review trigger registers pending async

- **GIVEN** a work fire that posts `@claude review this` on a PR
- **WHEN** Claude calls `record_fire_outcome({ outcome: "async-triggered", asyncKey: "org/repo#123" })`
- **THEN** `pendingAsync` contains `"org/repo#123"` and `consecutiveEmpty` is unchanged

#### Scenario: Duplicate trigger keys are not accumulated

- **GIVEN** `pendingAsync` already contains `"org/repo#123"`
- **WHEN** the same `asyncKey` is recorded again
- **THEN** `pendingAsync` still contains exactly one `"org/repo#123"` entry

#### Scenario: A productive fire clears pending async

- **GIVEN** `pendingAsync` is non-empty
- **WHEN** `record_activity` is called with a resetting kind (e.g. `comments_addressed`)
- **THEN** `consecutiveEmpty` becomes 0 and `pendingAsync` becomes empty

### Requirement: Sync-discovered work lifts the breaker in code

The `upsert_idea` handler SHALL reset `consecutiveEmpty` to 0 when the call creates a NEW open unit OR sets `freshInput: true` — with no prompt cooperation required, so a discovery or deep sync fire that surfaces work un-trips the breaker automatically. Parking writes (`blocked: true` on an existing unit), closes (`open: false`), and `ignore` writes SHALL NOT reset. The reset leaves `pendingAsync` untouched.

#### Scenario: Discovery sync surfacing a unit lifts the breaker

- **GIVEN** the breaker is tripped (`consecutiveEmpty` at threshold)
- **WHEN** a sync fire calls `upsert_idea` creating a new open unit
- **THEN** `consecutiveEmpty` becomes 0 and the next work fire proceeds normally

#### Scenario: Fresh input on a tracked unit lifts the breaker

- **GIVEN** the breaker is tripped
- **WHEN** `upsert_idea` is called with `freshInput: true` on an existing unit
- **THEN** `consecutiveEmpty` becomes 0

#### Scenario: Parking does not lift the breaker

- **GIVEN** stored `consecutiveEmpty: 2`
- **WHEN** `upsert_idea` is called with `blocked: true` on an existing unit
- **THEN** `consecutiveEmpty` remains 2

### Requirement: Configurable stop threshold

`idlerConfigSchema` SHALL gain `stopAfterEmptyRounds`: an integer in [0, 10], default 2, where 0 disables the breaker entirely. The field SHALL be settable via `set_idler_config` (patch-style, like its sibling knobs) and SHALL be read live at tool-call time — an edit applies on the next fire with no cron reconcile, because the knob feeds tool behavior rather than prompt content.

#### Scenario: Admin sets the threshold

- **WHEN** an admin calls `set_idler_config` with `stopAfterEmptyRounds: 3`
- **THEN** the persisted config validates and the next `list_top_ideas` call evaluates against threshold 3

#### Scenario: Zero disables the breaker

- **WHEN** an admin calls `set_idler_config` with `stopAfterEmptyRounds: 0`
- **THEN** no `nightBreaker` field is surfaced and work fires never early-exit on breaker state

#### Scenario: Out-of-range values are rejected

- **WHEN** `set_idler_config` is called with `stopAfterEmptyRounds: 11`
- **THEN** validation fails and the config is not written
