## REMOVED Requirements

### Requirement: 3-row dual-totals leaderboard rendering

**Reason**: The fixed 3-row shape (names / Current Season / All Time, always present, sorted by `currentSeasonCorrect`, top-3 medals) is replaced by an additive row model: `This Round` leads, `Current Season` is the always-present anchor, and `All Time` is gated by the new `allTimeRow` axis. Columns are sorted by `This Round`, and medals follow the unified dense-rank rule.

**Migration**: See ADDED "Seasons leaderboard row composition (normal reveals)" below, plus `trivia-scheduled-prompts` → "Reveal table leads with This Round" and "Dense-rank medal assignment across leaderboard rows".

### Requirement: Season-finale section in reveal flow

**Reason**: The single "finale section above the leaderboard table" (slug + MVP + wrap-up) is replaced by a dedicated finale layout: a Season Winners podium, a participation tail, and a gated All-Time table.

**Migration**: See ADDED "Season-finale reveal layout" below. The in-tool rollover behavior (stamping `endedAt`, optional new-season creation, reporting via `seasonStatus`) is preserved there unchanged.

## ADDED Requirements

### Requirement: Seasons leaderboard row composition (normal reveals)

When the `process_reveal_answers` payload includes a `seasonStatus` field (seasons enabled AND a current season exists) AND `seasonStatus.isLastFireOfSeason` is `false`, the reveal leaderboard `table` SHALL be composed additively from these rows, top to bottom:

- A names-header row: empty top-left label cell (a single space `" "`, never `""`), then one `displayName` cell per player column (no medals).
- A `This Round` row — present whenever `roundSummary` is present (see `trivia-scheduled-prompts` → "Reveal table leads with This Round").
- A `Current Season` row — ALWAYS present (the anchor row), each cell `String(currentSeasonCorrect)`.
- An `All Time` row — present IF AND ONLY IF `seasonStatus.hasPriorSeasons` is `true` AND `showAllTimeRow` is `true` (see "process_reveal_answers resolves allTimeRow"), each cell `String(totalCorrect)`.

When `seasonStatus.hasPriorSeasons` is `false` (only one season has had activity), the `All Time` row SHALL be omitted and the `Current Season` row SHALL still render with its `"Current Season"` label — replacing the prior unlabeled two-row form for the single-season case.

Player columns SHALL include only leaderboard entries with current-season participation (`currentSeasonCorrect > 0` OR `currentSeasonAnswered > 0`); the column order SHALL be the single shared order defined by `trivia-scheduled-prompts` (by `This Round` when present, else by `currentSeasonCorrect` descending). Any player appearing in `roundSummary.perPlayer` necessarily satisfies this inclusion rule — their this-round answer is stamped with the current season, so `currentSeasonAnswered > 0` — therefore the `This Round` source set is always a subset of the column set and never introduces a column the season rows lack. Medals on the `Current Season` and `All Time` rows SHALL follow the unified dense-rank rule, assigned per row independently. `column_settings` SHALL carry one `{ "align": "center" }` entry per column (label column + each player column).

#### Scenario: Multi-season normal reveal with All Time shown

- **GIVEN** `seasonStatus.hasPriorSeasons` is `true`, `isLastFireOfSeason` is `false`, `showAllTimeRow` is `true`, and `roundSummary` is present
- **WHEN** the reveal renders the leaderboard
- **THEN** the rows are names-header → This Round → Current Season → All Time
- **AND** every row uses the same column order (by This Round score, em-dash players last)

#### Scenario: All Time hidden by allTimeRow default

- **GIVEN** `seasonStatus.hasPriorSeasons` is `true`, `isLastFireOfSeason` is `false`, and `showAllTimeRow` is `false`
- **WHEN** the reveal renders the leaderboard
- **THEN** the table has no `All Time` row
- **AND** the rows are names-header → (This Round when present) → Current Season

#### Scenario: Single-season reveal labels the anchor row "Current Season"

- **GIVEN** `seasonStatus.hasPriorSeasons` is `false` and `isLastFireOfSeason` is `false`
- **WHEN** the reveal renders the leaderboard
- **THEN** the table contains a `Current Season` labeled row and no `All Time` row
- **AND** the prior unlabeled two-row single-season form is not used

#### Scenario: Zero-participation player omitted

- **GIVEN** a player with `currentSeasonCorrect: 0` and `currentSeasonAnswered: 0`
- **WHEN** the reveal renders the leaderboard
- **THEN** that player does not appear as a column

### Requirement: process_reveal_answers resolves allTimeRow into showAllTimeRow

When seasons are enabled and a current season exists, `process_reveal_answers` SHALL resolve the `allTimeRow` axis (cascade `game → workspace → "end-of-season-only"`, see `trivia-games`) and compute a boolean `showAllTimeRow` that it includes in the returned payload:

- `allTimeRow === "always"` → `showAllTimeRow = true`.
- `allTimeRow === "never"` → `showAllTimeRow = false`.
- `allTimeRow === "end-of-season-only"` → `showAllTimeRow = seasonStatus.isLastFireOfSeason`.

When `showAllTimeRow` is absent from the payload (e.g. older payloads, or seasons disabled), the renderer SHALL treat it as `true` for backward compatibility. `showAllTimeRow` governs BOTH the normal-reveal `All Time` row and the finale All-Time table; the All-Time surface additionally requires `seasonStatus.hasPriorSeasons === true`. Both `hasPriorSeasons` and `isLastFireOfSeason` SHALL reflect the timeline state as of reveal start — i.e. BEFORE the in-tool season-end rollover — so the All-Time gate is decided against the season that is closing, not any continuation season created during the same call.

#### Scenario: end-of-season-only resolves on last fire

- **GIVEN** the resolved `allTimeRow` is `"end-of-season-only"` and `seasonStatus.isLastFireOfSeason` is `true`
- **WHEN** `process_reveal_answers` builds its payload
- **THEN** `showAllTimeRow` is `true`

#### Scenario: end-of-season-only hides on normal day

- **GIVEN** the resolved `allTimeRow` is `"end-of-season-only"` and `seasonStatus.isLastFireOfSeason` is `false`
- **WHEN** `process_reveal_answers` builds its payload
- **THEN** `showAllTimeRow` is `false`

#### Scenario: never always hides

- **GIVEN** the resolved `allTimeRow` is `"never"`
- **WHEN** `process_reveal_answers` builds its payload
- **THEN** `showAllTimeRow` is `false` regardless of `isLastFireOfSeason`

### Requirement: Season-finale reveal layout

When `seasons.enabled` is `true` AND `seasonStatus.isLastFireOfSeason` is `true`, the reveal flow SHALL render a dedicated finale layout in place of the normal leaderboard table, in this order:

1. The per-question verdict blocks for the round just revealed (as in any reveal).
2. A **Season Winners** section introduced by a transition line (e.g. "And now, the season's winners!"). It SHALL present the final current-season standings as a vertical ranked list: the top three DISTINCT `currentSeasonCorrect` values rendered as `🥇 First place`, `🥈 Second place`, `🥉 Third place` lines (players tied on a value SHALL share that place and medal), each line naming the player(s) and their points (`currentSeasonCorrect`).
3. A one-line **participation tail** listing every remaining participant (below the podium) with their points, comma-separated; the player(s) at the 4th distinct value SHALL carry the `🎀` ribbon. Players with zero current-season participation SHALL be omitted.
4. An **All-Time table** — rendered IF AND ONLY IF `seasonStatus.hasPriorSeasons` is `true` AND `showAllTimeRow` is `true` — introduced by a transition line (e.g. "And the all-time leaderboard:"). It SHALL be a Slack `table` with a names-header row and an `All Time` row of `String(totalCorrect)`, columns ordered by `totalCorrect` descending, with medals following the unified dense-rank rule. When the gate fails (single season, or `allTimeRow` hides it), the All-Time table SHALL be omitted.
5. A closer line (e.g. "Thanks for playing, see you next season!"). The finale SHALL NOT preview the next season's slug, even when `seasonStatus.newSeasonStarted` is present.

"pts" SHALL mean `currentSeasonCorrect` — no separate scoring concept is introduced. Season-end rollover (stamping `endedAt` on the closing season and, when no continuation is queued, creating a new starter season) SHALL happen INSIDE `process_reveal_answers` before the tool returns; the renderer SHALL NOT call `upsert_season` as a follow-up. The rollover outcome SHALL be reported in `seasonStatus.seasonClosed` and `seasonStatus.newSeasonStarted` for informational use.

When `seasonStatus.isLastFireOfSeason` is `false` (or `seasonStatus` is absent), no finale layout is rendered and the normal leaderboard table (per "Seasons leaderboard row composition") is used.

#### Scenario: Finale renders podium, participation tail, and all-time table

- **GIVEN** `seasonStatus.isLastFireOfSeason` is `true`, `hasPriorSeasons` is `true`, and `showAllTimeRow` is `true`
- **WHEN** the reveal flow completes
- **THEN** the post contains a Season Winners podium with `🥇`/`🥈`/`🥉` place lines naming players and their `currentSeasonCorrect` points
- **AND** a one-line participation tail with the 4th distinct value carrying `🎀`
- **AND** an All-Time `table` with medals on the `All Time` row
- **AND** a "see you next season" style closer that does not preview the next season's slug
- **AND** `process_reveal_answers` already stamped `endedAt` before returning (no `upsert_season` follow-up)

#### Scenario: First season's finale omits the redundant all-time table

- **GIVEN** `seasonStatus.isLastFireOfSeason` is `true` and `hasPriorSeasons` is `false`
- **WHEN** the reveal flow completes
- **THEN** the finale renders the podium and participation tail and closer
- **AND** no All-Time table is rendered

#### Scenario: allTimeRow=never suppresses the finale all-time table

- **GIVEN** `seasonStatus.isLastFireOfSeason` is `true`, `hasPriorSeasons` is `true`, and `showAllTimeRow` is `false` (resolved from `allTimeRow: "never"`)
- **WHEN** the reveal flow completes
- **THEN** the finale renders the podium, participation tail, and closer with no All-Time table

#### Scenario: Tie shares a podium place

- **GIVEN** two players tied at the top `currentSeasonCorrect` value
- **WHEN** the finale podium renders
- **THEN** both players appear on the `🥇 First place` line
- **AND** the next distinct value is rendered as `🥈 Second place`

#### Scenario: Mid-season reveal uses the normal table

- **GIVEN** `seasonStatus.isLastFireOfSeason` is `false`
- **WHEN** the reveal flow completes
- **THEN** the post contains no Season Winners podium, participation tail, or finale closer
- **AND** the normal leaderboard table is rendered
