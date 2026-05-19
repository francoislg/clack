# trivia-managed-schedules Delta — add-trivia-off-days

## ADDED Requirements

### Requirement: Trivia Off-Days Config

The system SHALL accept an optional `trivia.offDays: OffDay[]` array in `data/config.json`. This is a plugin-level list shared by every entry in `trivia.games[]`; there is no per-game override.

```ts
interface OffDay {
  /** Either YYYY-MM-DD (exact date) or MM-DD (recurring annually). Interpreted in the matching cron job's timezone. */
  date: string;
  /** Human-readable label used in logs and Home Tab display. Required, non-empty. */
  label: string;
}
```

Validation rules:
- `date` SHALL match either `^\d{4}-\d{2}-\d{2}$` (exact date) or `^\d{2}-\d{2}$` (recurring), AND SHALL represent a real calendar date (no `02-30`, no `13-01`).
- `label` SHALL be a non-empty string.
- Invalid entries SHALL be dropped with a logged warning identifying the array index and the failed rule. Loading SHALL NOT throw — the rest of the config loads normally.

#### Scenario: Absent offDays is valid

- **GIVEN** `data/config.json` has no `trivia.offDays` field
- **WHEN** the config is loaded
- **THEN** the parsed config has `trivia.offDays === undefined`
- **AND** loading succeeds without warnings

#### Scenario: Empty offDays is valid

- **GIVEN** `data/config.json` has `trivia.offDays: []`
- **WHEN** the config is loaded
- **THEN** the parsed config has `trivia.offDays === []`
- **AND** loading succeeds without warnings

#### Scenario: Mixed exact + recurring dates parse through

- **GIVEN** `trivia.offDays: [{ date: "12-25", label: "Christmas" }, { date: "2026-04-03", label: "Good Friday 2026" }]`
- **WHEN** the config is loaded
- **THEN** both entries are present in the parsed `trivia.offDays`

#### Scenario: Unparseable date format warns and drops

- **GIVEN** an entry with `date: "December 25"` and `label: "Christmas"`
- **WHEN** the config is loaded
- **THEN** a warning is logged identifying the entry index and the date-format violation
- **AND** the entry is omitted from the parsed `trivia.offDays`

#### Scenario: Invalid calendar date warns and drops

- **GIVEN** an entry with `date: "02-30"` and `label: "Imaginary"`
- **WHEN** the config is loaded
- **THEN** a warning is logged identifying the entry as not a real calendar date
- **AND** the entry is omitted

#### Scenario: Missing label warns and drops

- **GIVEN** an entry with `date: "12-25"` and no `label` field (or empty-string `label`)
- **WHEN** the config is loaded
- **THEN** a warning is logged identifying the missing label
- **AND** the entry is omitted

#### Scenario: Valid entries are kept when other entries are invalid

- **GIVEN** `trivia.offDays: [{ date: "12-25", label: "Christmas" }, { date: "bogus", label: "x" }]`
- **WHEN** the config is loaded
- **THEN** the Christmas entry is present in the parsed `trivia.offDays`
- **AND** the `"bogus"` entry is dropped with a warning

### Requirement: Off-Days Propagation Through Game Specs

`buildGameSpecs(games, seasonsEnabled, offDays?)` SHALL accept an `offDays` parameter and propagate it into every emitted spec's `skipDates` field. The trivia plugin's init SHALL read `config.trivia.offDays` and pass it to `buildGameSpecs`.

When `offDays` is absent or empty, the emitted specs SHALL omit the `skipDates` field entirely (no empty-array writes).

#### Scenario: offDays propagates into every spec

- **GIVEN** `config.trivia.games` with two entries and `config.trivia.offDays: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** `buildGameSpecs` runs
- **THEN** all four emitted specs (two games × question + reveal) have `skipDates: [{ date: "12-25", label: "Christmas" }]`

#### Scenario: Absent offDays yields specs without skipDates

- **GIVEN** `config.trivia.games` with one entry and no `config.trivia.offDays`
- **WHEN** `buildGameSpecs` runs
- **THEN** both emitted specs have `skipDates === undefined` (the field is not present in the spec object)

#### Scenario: Updating offDays re-reconciles in place

- **GIVEN** a plugin-managed trivia cron job with `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** `config.trivia.offDays` is edited to `[{ date: "12-25", label: "Christmas" }, { date: "01-01", label: "New Year's Day" }]` and the trivia plugin re-runs reconcile
- **THEN** the same job now has both entries in `skipDates`
- **AND** the job's `id`, `runs[]`, and `enabled` are preserved
