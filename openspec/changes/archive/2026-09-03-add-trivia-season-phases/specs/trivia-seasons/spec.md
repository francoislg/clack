## ADDED Requirements

### Requirement: seasons.json is read through a permissive schema carrying optional phases

`loadSeasonsState` currently returns an unvalidated `JSON.parse` cast, so there is no per-field drop mechanism to extend. This capability SHALL introduce a **permissive** zod schema for `SeasonsState` / `SeasonEntry` — modelled on the `ParseIssue`-accumulating pattern in `core/configParsers/games.ts` — and route `loadSeasonsState` through it. The schema SHALL accept an optional `phases: PhaseSlice[]` on each season entry.

The reader is **graceful** (persisted state), so it SHALL model legacy and optional on-disk fields, SHALL NOT be `.strict()`, and on a mismatch SHALL log and fall back to the existing value rather than discarding real state. Concretely: a malformed `phases` value SHALL drop only the `phases` field with a logged issue naming the season slug, leaving the rest of the entry intact — it SHALL NOT discard the season or any other season in the file.

A well-typed `phases` array that violates a phase **domain invariant** (duplicate slug, a non-final slice missing `days`, a final slice declaring `days`) SHALL likewise drop the whole `phases` field for that season — not the individual slice — because a partially-applied chain would silently shift every subsequent slice's window. Individual unknown or disallowed **fields** on an otherwise-valid slice drop field-by-field.

Absence of `phases` SHALL be the state of every existing season on disk and SHALL resolve identically to the pre-phase cascade. No migration SHALL be required.

#### Scenario: Existing seasons parse unchanged

- **GIVEN** a `seasons.json` written before this capability
- **WHEN** the file is loaded
- **THEN** every season parses with no `phases` field and no logged issue

#### Scenario: Malformed phases drop without losing the season

- **GIVEN** a season whose `phases` is a string instead of an array
- **WHEN** the file is loaded
- **THEN** the season survives with no `phases` field
- **AND** a logged issue names the season's slug and the `phases` field

#### Scenario: Invariant-violating phases drop the whole array

- **GIVEN** a season whose `phases` is a well-typed array containing two slices with the same `slug`
- **WHEN** the file is loaded
- **THEN** the season survives with no `phases` field, and no partial chain is applied
- **AND** a logged issue names the season's slug and the violated invariant

#### Scenario: One bad season does not affect its siblings

- **GIVEN** a `seasons.json` with three seasons, one of which has a malformed `phases`
- **WHEN** the file is loaded
- **THEN** the other two seasons parse with their `phases` intact

### Requirement: upsert_season writes phases

`upsert_season` SHALL accept an optional `phases` argument following the tool family's omit-to-keep / null-to-clear convention: omitting it leaves any existing phases untouched, passing `null` clears them, and passing an array replaces them wholesale. The strict tool path SHALL validate the array against the same schema the lenient file loader uses, rejecting the write with a message naming the offending slice.

Phases MAY be edited mid-season. Because resolution is stamped per question, an edit SHALL affect only questions written after it — already-posed questions keep the phase they were stamped with.

#### Scenario: Phases are replaced wholesale

- **GIVEN** a season with three phases
- **WHEN** `upsert_season` is called with a two-entry `phases` array
- **THEN** the season's phases are exactly those two entries

#### Scenario: Omitting phases preserves them

- **GIVEN** a season with phases set
- **WHEN** `upsert_season` is called changing only `theme`
- **THEN** the season's phases are unchanged

#### Scenario: Clearing phases restores phaseless resolution

- **GIVEN** a season with phases set
- **WHEN** `upsert_season` is called with `phases: null`
- **THEN** the season carries no `phases` field
- **AND** subsequent resolutions report no `seasonPhase` tier

#### Scenario: Invalid phases reject the write

- **WHEN** `upsert_season` is called with a `phases` array whose final slice declares `days`
- **THEN** the tool rejects the call naming that slice
- **AND** the season on disk is unmodified

#### Scenario: A mid-season phases edit does not affect already-posed questions

- **GIVEN** a question Q1 posted yesterday and stamped `phase: "warmup"`
- **WHEN** an admin calls `upsert_season` shortening `warmup` or removing it entirely
- **THEN** Q1 keeps its `warmup` stamp, and its reveal resolves through the phase it was posed under (or through no phase tier if the slice was removed)
- **AND** a question written after the edit resolves against the updated `phases`

### Requirement: list_seasons surfaces the derived phase timeline

`list_seasons` SHALL, for every season that declares `phases`, include each slice's `slug`, its **computed** start and end timestamps, and which slice (if any) is currently active. Seasons with no `phases` SHALL be rendered exactly as before, with no phase-related keys.

Because phase boundaries are derived from `startedAt` and the chained `days` values, this is the only surface on which an admin can see when a phase actually flips.

#### Scenario: Computed windows are rendered

- **GIVEN** a season starting 2026-11-01 with phases `[{ slug: "warmup", days: 14 }, { slug: "gauntlet" }]` and an `expectedEndAt` of 2026-12-01
- **WHEN** `list_seasons` is called
- **THEN** the entry reports `warmup` spanning 2026-11-01 to 2026-11-15 and `gauntlet` spanning 2026-11-15 to 2026-12-01

#### Scenario: The active phase is marked

- **GIVEN** the season above and a current date of 2026-11-20
- **WHEN** `list_seasons` is called
- **THEN** `gauntlet` is marked active and `warmup` is not

#### Scenario: Phaseless seasons render unchanged

- **GIVEN** a season with no `phases`
- **WHEN** `list_seasons` is called
- **THEN** the entry contains no phase-related keys
