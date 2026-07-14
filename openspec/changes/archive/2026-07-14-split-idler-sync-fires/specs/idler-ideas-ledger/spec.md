# idler-ideas-ledger — delta for split-idler-sync-fires

## MODIFIED Requirements

### Requirement: Sync-recomputed priority

The DEEP sync fire SHALL recompute each open unit's `priority` on every run from three contributions: the kind of pending work (where `continue > triage > implement > review` in weight), fresh-input signals detected by re-running each reference's `howToRead` (a human reply or a new comment past the `cursor` raises priority), and blocked-now signals (waiting on a human with no activity past the `cursor` lowers priority). Light sync fires SHALL adjust priority only for the entries they triage or adopt — they do not re-poll tracked units' references. A newly-adopted entry SHALL receive its initial `priority` from the same kind-of-pending-work contribution any source's adoption uses (computed by Clack at `upsert_idea` time from the unit's kind), not a fixed default and not a light-fire-specific algorithm. Clack SHALL be able to override the computed score via a reprioritize tool.

#### Scenario: Blocked unit sinks

- **GIVEN** a unit awaiting a human reply with no new activity past its cursor
- **WHEN** the deep sync fire recomputes priority
- **THEN** the unit's priority is lowered so the work task will not select it

#### Scenario: Fresh reply resurfaces a blocked unit

- **GIVEN** a previously blocked unit
- **WHEN** the deep sync fire re-runs its reference `howToRead` and detects a new reply past the cursor
- **THEN** the unit's priority is raised so the next work fire selects it

#### Scenario: Clack reprioritization overrides the computed score

- **WHEN** Clack calls the reprioritize tool on a unit
- **THEN** the unit's effective priority reflects Clack's override

#### Scenario: Light fires do not re-poll tracked references

- **GIVEN** a tracked unit with no memory change since the last fire
- **WHEN** a light sync fire runs
- **THEN** the unit's references are not re-read and its priority is untouched

### Requirement: Coldest-first ordering for the concierge rotation

`list_top_ideas` SHALL accept a `sort_by` argument with two orderings: `"priority"` (the default — open units sorted by `priority` descending, the selection order the work fire uses) and `"coldest"` (open units sorted by `updatedAt` ascending — least-recently-attended first). Because every `upsert_idea` write bumps the entry's `updatedAt`, re-verifying a unit moves it to the back of the `"coldest"` ordering, yielding a round-robin rotation across successive DEEP sync fires (one per sync-window day). The default ordering and the work fire's behavior SHALL be unchanged when `sort_by` is omitted.

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

On each DEEP sync fire the concierge SHALL retrieve the coldest open units — bounded by the read tool's `limit` so the worklist is a small fixed-size rotation rather than the whole ledger — and re-verify each by re-running its references' `howToRead` to detect activity past the recorded cursor. Light sync fires SHALL NOT run this rotation. Ignored entries (`open: false`) are not retrieved. A unit the concierge judges stale — `overdue`, or, in its judgment, long-untouched with no fresh activity past its cursor — SHALL be parked by lowering its priority through the existing blocked-now sink (`upsert_idea` with `blocked: true`); staleness past the `overdue` flag is the concierge's judgment, not a fixed threshold. A parked unit SHALL remain `open` (it is neither closed nor deleted) so it drops out of the work fire's top-N selection window while staying eligible to resurface. A unit with genuine fresh input SHALL NOT be parked.

#### Scenario: Overdue zombie is parked out of the work window

- **GIVEN** a high-priority open unit that is `overdue` with no fresh activity past its cursor
- **WHEN** the concierge re-verifies it during a deep sync fire
- **THEN** it is parked via the blocked sink so its priority drops below workable units
- **AND** it remains an open unit (not closed, not deleted)

#### Scenario: Parked unit resurfaces on fresh activity

- **GIVEN** a previously parked (blocked) open unit
- **WHEN** a later deep sync fire detects new activity past its cursor (fresh input)
- **THEN** its priority is raised so the next work fire can select it

#### Scenario: A unit with fresh input is not parked

- **GIVEN** an open unit that is `overdue` but has a new human reply past its cursor
- **WHEN** the concierge re-verifies it
- **THEN** it is treated as fresh input (raised), not parked
