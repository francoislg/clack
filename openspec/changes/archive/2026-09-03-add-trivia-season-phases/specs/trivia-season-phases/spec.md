## ADDED Requirements

### Requirement: PhaseSlice is a temporal axis bag

The Trivia plugin SHALL define a `PhaseSlice` type that `extends CascadeAxes` and adds exactly four own fields: a required `slug`, and optional `days`, `theme`, and `categories`. It is the temporal twin of `SeasonFormatSlot` (the positional axis bag) — the same axis surface, selected by time rather than by index.

`slug` MUST be non-empty kebab-case, validated by the same `validateSeasonSlug` rule that season slugs use, and MUST be unique within a season's `phases` array. `days`, when present, MUST be a positive integer. `theme`, when present, MUST be non-empty after trim, and SHALL be trimmed before storing. `categories`, when present, MUST be a non-empty array of strings and SHALL be deduped (preserving first-occurrence order) at write and load time rather than rejected for containing duplicates — matching the game-tier `categories` policy.

`PhaseSlice` SHALL NOT carry `format`, `slotOverrides`, or any scoring-identity field (`teams`, `teamsEnabled`, `teamsFinaleIndividuals`, `teamsScoring`, `answeringType`, `perfectRoundsAward`, `allTimeRow`). A phase changes what questions are *like*; it never changes what a round *is* or how it is *scored*.

#### Scenario: Every cascade axis is settable on a phase

- **WHEN** a `PhaseSlice` is inspected for any `keyof CascadeAxes` member
- **THEN** the axis is readable by that key on the slice, exactly as on `SeasonFormatSlot`, `SeasonEntry`, `TriviaGame`, and `TriviaConfig`
- **AND** a new `CascadeAxes` member added later is settable on a phase with no additional work

#### Scenario: upsert_season rejects a structural or scoring field on a phase

- **WHEN** `upsert_season` is called with a `phases` entry declaring `format`, `slotOverrides`, `teams`, `teamsEnabled`, `teamsFinaleIndividuals`, `teamsScoring`, `answeringType`, `perfectRoundsAward`, or `allTimeRow`
- **THEN** the tool rejects the write naming the offending field
- **AND** the season on disk is unmodified

#### Scenario: File loader drops a structural or scoring field without dropping the slice

- **GIVEN** an on-disk `seasons.json` whose `phases[0]` carries `answeringType` alongside valid axes
- **WHEN** the file is loaded
- **THEN** the slice survives with its valid axes and without `answeringType`
- **AND** a logged issue names the offending field

#### Scenario: Duplicate slug within a season is rejected

- **WHEN** a season's `phases` array contains two slices with the same `slug`
- **THEN** the write is rejected naming the duplicated slug

#### Scenario: Non-positive or fractional days is rejected

- **WHEN** a `phases` entry declares `days` of `0`, a negative number, or `1.5`
- **THEN** the write is rejected naming that slice's slug and the `days` field

#### Scenario: Blank phase theme is rejected

- **WHEN** a `phases` entry declares `theme` of `"   "` (whitespace only)
- **THEN** the write is rejected naming that slice's slug
- **AND** a non-blank `theme` is stored trimmed

#### Scenario: Empty phase categories is rejected and duplicates are deduped

- **WHEN** a `phases` entry declares `categories: []`
- **THEN** the write is rejected naming that slice's slug
- **AND** a `categories` array containing duplicates is stored deduped, preserving first-occurrence order

### Requirement: Phases are duration-chained from the season start

A `SeasonEntry` MAY carry an optional ordered `phases: PhaseSlice[]`. Slice windows SHALL be **derived**, never stored: slice 0 begins at `season.startedAt`, and slice *n* begins where slice *n−1* ended. Each slice's end is its start plus `days` days.

The **final** slice MUST omit `days` and SHALL run open-ended to the season's end (`endedAt ?? expectedEndAt`). Every non-final slice MUST declare `days`. Because windows chain, overlap is impossible by construction and no interval-overlap validation SHALL be performed on phases.

A `phases` array, when present, MUST contain at least one slice.

#### Scenario: Windows chain from the season start

- **GIVEN** a season starting 2026-11-01 with phases `[{ slug: "warmup", days: 14 }, { slug: "ramp", days: 14 }, { slug: "gauntlet" }]`
- **WHEN** the derived windows are computed
- **THEN** `warmup` covers 2026-11-01 through 2026-11-15, `ramp` covers 2026-11-15 through 2026-11-29, and `gauntlet` covers 2026-11-29 through the season's end

#### Scenario: A season extension is absorbed by the open-ended final slice

- **GIVEN** the season above with `expectedEndAt` of 2026-12-01
- **WHEN** `expectedEndAt` is moved to 2027-01-01
- **THEN** the `warmup` and `ramp` windows are unchanged
- **AND** `gauntlet` now runs 2026-11-29 through 2027-01-01 with no configuration edit

#### Scenario: Non-final slice missing days is rejected

- **WHEN** a `phases` array declares a slice without `days` at any position other than the last
- **THEN** the write is rejected naming that slice's slug

#### Scenario: Final slice declaring days is rejected

- **WHEN** the last entry of a `phases` array declares `days`
- **THEN** the write is rejected, since the final slice runs to the season's end

### Requirement: Phase selection is a pure function of season and time

The plugin SHALL provide a pure selector `(season, now) → PhaseSlice | null` that returns the slice whose derived window contains `now`, using half-open `[start, end)` windows. It SHALL return `null` when the season declares no `phases`, or when `now` falls outside the season's own window.

`buildCascadeContext` SHALL call this selector and populate a new `seasonPhase` field on `CascadeContext`. No other code SHALL derive a phase window — `buildCascadeContext` is the single sourcing point, matching the existing rule for `gameSlot` and `seasonSlot`.

#### Scenario: The slice containing now is selected

- **GIVEN** the chained season above and `now` of 2026-11-20
- **WHEN** `buildCascadeContext` runs
- **THEN** `ctx.seasonPhase` is the `ramp` slice

#### Scenario: Boundaries are half-open

- **GIVEN** the chained season above and `now` exactly at 2026-11-15T00:00:00
- **WHEN** the selector runs
- **THEN** it returns `ramp`, not `warmup`

#### Scenario: No phases means no phase tier

- **GIVEN** an active season with no `phases` field
- **WHEN** `buildCascadeContext` runs
- **THEN** `ctx.seasonPhase` is `null`
- **AND** every axis resolves to exactly the value it resolved to before this capability existed

#### Scenario: No active season means no phase tier

- **GIVEN** seasons are disabled, or no season's window contains `now`
- **WHEN** `buildCascadeContext` runs
- **THEN** `ctx.seasonPhase` is `null`
- **AND** every axis resolves to exactly the value it resolved to before this capability existed

### Requirement: The seasonPhase tier sits below seasonSlot and above season

The cascade order SHALL be **`seasonSlot → seasonPhase → season → gameSlot → game → workspace → built-in default`**. A phase therefore overrides its own season, but a season's per-slot override wins over the phase.

This placement is what lets a **season slot** pin a value against phase movement: an axis set at `seasonSlot` keeps its value through every phase, while every axis the season slots leave unset is free for the phase to move.

Pinning is a `seasonSlot` capability ONLY. `seasonPhase` outranks `gameSlot`, so an axis set on the GAME format's slot is overridden by an active phase — consistent with the pre-existing rule that `season` already outranks `gameSlot`. An admin who wants a per-slot value to survive escalation MUST express it as a season slot override (`season.slotOverrides[i]`), not on the game format. The game format still supplies the question COUNT and the per-slot base for everything no phase touches.

#### Scenario: Phase overrides the season tier

- **GIVEN** a season sets `difficultyRatio` and its active phase sets a different `difficultyRatio`
- **WHEN** `resolveCascade("difficultyRatio", ctx)` runs
- **THEN** the phase's value wins
- **AND** the resolution reports `tier: "seasonPhase"`

#### Scenario: A season slot pins a value against the phase

- **GIVEN** `season.slotOverrides[0]` sets `difficultyRatio` to an all-easy map
- **AND** the active phase sets `difficultyRatio` to an all-hard map
- **WHEN** `resolveCascade("difficultyRatio", ctx)` runs for slot 0
- **THEN** the slot's all-easy value wins and the resolution reports `tier: "seasonSlot"`
- **AND** for a slot that sets no `difficultyRatio`, the phase's all-hard value wins

#### Scenario: A game-format slot does NOT pin against the phase

- **GIVEN** `game.format.questions[0]` sets `difficultyRatio` to an all-easy map
- **AND** no season slot override exists for index 0
- **AND** the active phase sets `difficultyRatio` to an all-hard map
- **WHEN** `resolveCascade("difficultyRatio", ctx)` runs for slot 0
- **THEN** the phase's all-hard value wins and the resolution reports `tier: "seasonPhase"`
- **AND** the game slot's value is still reported in the `ladder` as present but not the winner

#### Scenario: Phase contributes its own additionalInstructions segment

- **GIVEN** the workspace, season, and active phase each set `additionalInstructions`
- **WHEN** `resolveCascade("additionalInstructions", ctx)` runs
- **THEN** the result concatenates all three segments broadest-first, each prefixed with its tier label
- **AND** the phase's segment is labelled `[Phase]`
- **AND** the resolution reports `tier: "merged"`

### Requirement: Phase slug is stamped on the question record

`save_question` SHALL stamp the resolved phase's `slug` onto the question record as an optional `phase: string` field, parallel to the existing `season` stamp. Absence SHALL mean "no phase tier applied", and SHALL be the state of every record written before this capability existed.

`process_reveal_answers` SHALL reconstruct the phase tier by looking the **stamped** slug up on the season, and SHALL NOT re-select a phase from the current time. When the stamped slug no longer matches any slice on the season (renamed or removed phase), the reveal SHALL resolve with **no phase tier** rather than adopting a different phase's values.

The season the slug is looked up on SHALL be the question's own **stamped** season (`question.season`, resolved via `findSeasonBySlug`), not the season active at reveal time — otherwise a season rollover between post and reveal would place a stamp-correct phase inside a different season's slice list. When the question carries no season stamp, or the stamped slug resolves to no season, the reveal SHALL fall back to the season it uses today (the one active at reveal time), preserving current behavior. This stamped-season binding SHALL apply only to the cascade context; teams, finale detection, and perfect-rounds resolution keep their existing reveal-time season.

`process_reveal_answers` resolves `instructions` / `additionalInstructions` **once per reveal batch**, not per question. The batch's phase tier SHALL be anchored on the **first reveal target's** stamped phase, matching the existing `firstSlotIndex` convention — a batch whose questions carry differing stamps resolves against the first one rather than mixing tiers.

#### Scenario: Reveal reads the stamp, not the clock

- **GIVEN** a question stamped `phase: "ramp"` whose reveal fires after the `gauntlet` window has begun
- **WHEN** `process_reveal_answers` resolves `instructions` and `additionalInstructions` for that question
- **THEN** it resolves them through the `ramp` slice
- **AND** the `gauntlet` slice contributes nothing

#### Scenario: Phase is looked up on the question's stamped season

- **GIVEN** a question stamped `season: "autumn"`, `phase: "gauntlet"`
- **AND** a different season is active by the time its reveal fires
- **WHEN** `process_reveal_answers` builds the reveal cascade context
- **THEN** the phase tier is the `gauntlet` slice of the `autumn` season
- **AND** the active season's own slices are not consulted

#### Scenario: A batch with mixed stamps anchors on the first target

- **GIVEN** a reveal batch whose first question is stamped `phase: "ramp"` and whose second is stamped `phase: "gauntlet"`
- **WHEN** `process_reveal_answers` resolves the batch's `instructions` and `additionalInstructions`
- **THEN** they resolve through the `ramp` slice

#### Scenario: A removed phase degrades gracefully

- **GIVEN** a question stamped `phase: "ramp"` and a season whose `phases` no longer contains that slug
- **WHEN** `process_reveal_answers` resolves the question
- **THEN** resolution proceeds with no phase tier
- **AND** no error is raised and no other slice is substituted

#### Scenario: No stamp on a phaseless season

- **GIVEN** an active season with no `phases`
- **WHEN** `save_question` writes a record
- **THEN** the record carries no `phase` key

### Requirement: Derived phase windows are surfaced to admins

Because phase boundaries are computed and never stored, the read surfaces SHALL render them. `list_seasons` SHALL, for each season that declares `phases`, return every slice's `slug`, its **computed** start and end, and which slice is currently active. `explain_cascade` SHALL identify the active phase for the resolved coordinate alongside its existing per-axis ladder.

#### Scenario: list_seasons renders the computed timeline

- **GIVEN** the chained season above and a current date of 2026-11-20
- **WHEN** `list_seasons` is called
- **THEN** the response lists `warmup`, `ramp`, and `gauntlet` with their computed start/end dates
- **AND** marks `ramp` as active

#### Scenario: explain_cascade names the active phase

- **WHEN** `explain_cascade({ game: "x", slot: 0 })` runs while a phase is active
- **THEN** the response names the active phase slug
- **AND** each axis whose winning tier is the phase reports `tier: "seasonPhase"`
