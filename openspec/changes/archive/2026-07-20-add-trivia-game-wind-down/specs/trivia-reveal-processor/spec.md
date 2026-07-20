# trivia-reveal-processor — delta for add-trivia-game-wind-down

## ADDED Requirements

### Requirement: `compute_answers` reports seasonless wind-down eligibility

The `compute_answers` payload SHALL include an optional `windDown: { eligible: true }` field — the seasonless analog of `seasonStatus.isLastFireOfSeason` — emitted IF AND ONLY IF all of:

1. The game has NO active season (seasons disabled workspace-wide, or the game's timeline is in a gap).
2. The game's `disableAfterRound` is `true`.
3. After this call's processing, zero unrevealed posted questions remain for the game (the board is cleared).

When any condition fails, the field SHALL be absent (never `{ eligible: false }`). The field is REPORT-ONLY: `compute_answers` performs no config mutation and no disable — the caller invokes `end_season` separately, whose seasonless branch performs the wind-down (mirroring the existing report-only `seasonStatus` / rollover split). When the game has an active season, `windDown` SHALL be absent regardless of the flag — the season branch of `end_season` owns wind-down there, gated by `isLastFireOfSeason`.

#### Scenario: Eligible after a board-clearing seasonless reveal

- **GIVEN** a seasonless game with `disableAfterRound: true`
- **WHEN** `compute_answers` processes the last unrevealed question
- **THEN** the payload carries `windDown: { eligible: true }`
- **AND** the tool performs no config write

#### Scenario: Absent while questions remain

- **GIVEN** a seasonless game with `disableAfterRound: true` and other questions still unrevealed
- **WHEN** `compute_answers` processes a question
- **THEN** the payload carries no `windDown` field

#### Scenario: Absent without the flag

- **GIVEN** a seasonless game without `disableAfterRound`
- **WHEN** `compute_answers` clears the board
- **THEN** the payload carries no `windDown` field

#### Scenario: Absent when a season is active

- **GIVEN** a game with an active season and `disableAfterRound: true`
- **WHEN** `compute_answers` runs
- **THEN** the payload carries no `windDown` field (the seasons path owns wind-down via `end_season`)
