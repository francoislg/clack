## ADDED Requirements

### Requirement: Concierge staleness visibility

The idler's ledger read tool (`list_top_ideas`) SHALL expose, for each returned open unit, the entry's `updatedAt` and `staleAfter` plus a server-computed `overdue` boolean (`true` when the unit has a `staleAfter.date` that is in the past relative to the current time, `false` otherwise). The tool SHALL compute `overdue` itself so the consumer never performs date arithmetic. These fields SHALL be additive — existing fields (`id`, `what`, `whereWeAre`, `nextSteps`, `priority`, `references`, `cursorsByRefId`) remain unchanged.

#### Scenario: Staleness fields accompany each unit

- **WHEN** `list_top_ideas` returns an open unit
- **THEN** the unit includes its `updatedAt`, its `staleAfter` (or absent when none is set), and an `overdue` boolean

#### Scenario: Overdue computed from staleAfter against now

- **GIVEN** an open unit whose `staleAfter.date` is earlier than the current time
- **WHEN** `list_top_ideas` returns it
- **THEN** its `overdue` field is `true`
- **AND** a unit with no `staleAfter.date`, or a `staleAfter.date` in the future, has `overdue: false`

### Requirement: Coldest-first ordering for the concierge rotation

`list_top_ideas` SHALL accept a `sort_by` argument with two orderings: `"priority"` (the default — open units sorted by `priority` descending, the selection order the work fire uses) and `"coldest"` (open units sorted by `updatedAt` ascending — least-recently-attended first). Because every `upsert_idea` write bumps the entry's `updatedAt`, re-verifying a unit moves it to the back of the `"coldest"` ordering, yielding a round-robin rotation across successive sync fires. The default ordering and the work fire's behavior SHALL be unchanged when `sort_by` is omitted.

#### Scenario: Priority ordering is the default

- **WHEN** `list_top_ideas` is called without `sort_by`
- **THEN** open units are returned sorted by `priority` descending, as before

#### Scenario: Coldest ordering surfaces least-recently-attended first

- **GIVEN** open units with differing `updatedAt` values
- **WHEN** `list_top_ideas` is called with `sort_by: "coldest"`
- **THEN** the unit with the oldest `updatedAt` is returned first, ascending by `updatedAt`

#### Scenario: Re-verification rotates a unit to the back

- **GIVEN** a unit returned first under `sort_by: "coldest"`
- **WHEN** the concierge re-verifies it via `upsert_idea` (bumping its `updatedAt`)
- **THEN** on the next `sort_by: "coldest"` call it is no longer first — other, older units precede it

### Requirement: Concierge parks stale units via the existing sink

On each sync fire the concierge SHALL retrieve the coldest open units — bounded by the read tool's `limit` so the worklist is a small fixed-size rotation rather than the whole ledger — and re-verify each by re-running its references' `howToRead` to detect activity past the recorded cursor. Ignored entries (`open: false`) are not retrieved. A unit the concierge judges stale — `overdue`, or, in its judgment, long-untouched with no fresh activity past its cursor — SHALL be parked by lowering its priority through the existing blocked-now sink (`upsert_idea` with `blocked: true`); staleness past the `overdue` flag is the concierge's judgment, not a fixed threshold. A parked unit SHALL remain `open` (it is neither closed nor deleted) so it drops out of the work fire's top-N selection window while staying eligible to resurface. A unit with genuine fresh input SHALL NOT be parked.

#### Scenario: Overdue zombie is parked out of the work window

- **GIVEN** a high-priority open unit that is `overdue` with no fresh activity past its cursor
- **WHEN** the concierge re-verifies it during a sync fire
- **THEN** it is parked via the blocked sink so its priority drops below workable units
- **AND** it remains an open unit (not closed, not deleted)

#### Scenario: Parked unit resurfaces on fresh activity

- **GIVEN** a previously parked (blocked) open unit
- **WHEN** a later sync fire detects new activity past its cursor (fresh input)
- **THEN** its priority is raised so the next work fire can select it

#### Scenario: A unit with fresh input is not parked

- **GIVEN** an open unit that is `overdue` but has a new human reply past its cursor
- **WHEN** the concierge re-verifies it
- **THEN** it is treated as fresh input (raised), not parked
