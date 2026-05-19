## MODIFIED Requirements

### Requirement: Season-finale section in reveal flow

When `seasons.enabled` is `true` AND the `process_reveal_answers` tool's returned `seasonStatus.isLastFireOfSeason` is `true` for the active game, the reveal flow SHALL render an additional **season-finale section** above the leaderboard table. The finale section SHALL summarize the closing season — its slug (from `seasonStatus.currentSlug`), the season MVP (from `seasonStatus.mvp`, populated by the tool from the current-season-ordered leaderboard), and a brief Game-Show-Presenter wrap-up paragraph in the persona's voice. The finale SHALL NOT preview the next season's slug, even when `seasonStatus.newSeasonStarted` is present — that's left to a subsequent reveal to announce.

When `seasonStatus.isLastFireOfSeason` is `false` (or `seasonStatus` is absent because seasons are disabled), no finale section is rendered.

Season-end rollover (stamping `endedAt` on the closing season and, when no continuation is queued, creating a new starter season) SHALL happen INSIDE `process_reveal_answers` before the tool returns. The reveal renderer SHALL NOT call `upsert_season` as a follow-up step. The outcome of any rollover SHALL be reported in `seasonStatus.seasonClosed` and `seasonStatus.newSeasonStarted` for informational use by the renderer.

#### Scenario: Mid-season reveal has no finale

- **GIVEN** `seasons.enabled` is `true` and `seasonStatus.isLastFireOfSeason` is `false` in the returned payload
- **WHEN** the reveal flow completes
- **THEN** the posted reveal contains no "season finale" header, paragraph, or MVP callout

#### Scenario: Season-end reveal includes finale before leaderboard

- **GIVEN** `seasons.enabled` is `true` and `seasonStatus.isLastFireOfSeason` is `true` in the returned payload
- **WHEN** the reveal flow completes
- **THEN** the posted reveal contains a section announcing the closing season's slug and naming the MVP from `seasonStatus.mvp`
- **AND** the section appears above the 3-row leaderboard table
- **AND** `process_reveal_answers` already stamped `endedAt` on the closing season before returning (the renderer does NOT call `upsert_season`)
- **AND** the renderer does NOT preview the new season's slug, even when `seasonStatus.newSeasonStarted` is present

### Requirement: 3-row dual-totals leaderboard rendering

When the payload returned by `process_reveal_answers` includes a `seasonStatus` field (which the tool populates when and only when `trivia.seasons.enabled === true` AND a current season exists for the game), the leaderboard `table` parameter passed to `submit_response` at reveal time SHALL be a 3-row table:

- **Row 1** — empty top-left cell, then one cell per player containing the player's `displayName` (NO medal prefix on this row).
- **Row 2** — left cell text `"Current Season"`, then one cell per player containing `currentSeasonCorrect` as a string, with medal prefix `🥇 `, `🥈 `, `🥉 ` (Unicode characters, not Slack shortcodes) on the player(s) holding the top-3 current-season scores.
- **Row 3** — left cell text `"All Time"`, then one cell per player containing `totalCorrect` as a string, with medal prefix `🥇 `, `🥈 `, `🥉 ` on the player(s) holding the top-3 all-time scores. The all-time medal assignment SHALL be independent of the current-season medal assignment.

Column order SHALL be by `currentSeasonCorrect` descending; ties SHALL be broken by `totalCorrect` descending. This ordering is already applied by the shared `computeLeaderboard` helper that the tool calls — the renderer SHALL NOT re-sort.

Players who have not participated in the current season (i.e., `currentSeasonCorrect === 0` AND `currentSeasonAnswered === 0`) SHALL be omitted from the table.

`column_settings` SHALL contain one entry per column with `{ "align": "center" }`. Where fewer than 3 players exist in the current season, medals SHALL be assigned in order to whichever players exist.

When the payload's `seasonStatus` field is absent (seasons disabled OR a current-season gap), the leaderboard SHALL render as the prior 2-row form (names row + scores row).

#### Scenario: Three-or-more-player season-active reveal

- **GIVEN** the payload includes `seasonStatus` and the `leaderboard` contains at least three players with non-zero current-season participation
- **AND** Alice has `currentSeasonCorrect: 5, totalCorrect: 20`
- **AND** Bob has `currentSeasonCorrect: 2, totalCorrect: 25`
- **AND** Carol has `currentSeasonCorrect: 1, totalCorrect: 8`
- **WHEN** the reveal renders the leaderboard
- **THEN** the table has 3 rows × 4 columns
- **AND** row 1 is `["", "Alice", "Bob", "Carol"]` (no medals on the names row)
- **AND** row 2 is `["Current Season", "🥇 5", "🥈 2", "🥉 1"]`
- **AND** row 3 is `["All Time", "🥈 20", "🥇 25", "🥉 8"]` (Bob is the all-time #1 despite Alice's current-season #1)

#### Scenario: Player with 0 current-season is omitted

- **GIVEN** Dave has `currentSeasonCorrect: 0`, `currentSeasonAnswered: 0`, `totalCorrect: 50` in the leaderboard
- **WHEN** the reveal renders the leaderboard
- **THEN** Dave does NOT appear as a column

#### Scenario: Fewer than three current-season players

- **GIVEN** only two players have current-season participation: Alice (5) and Bob (2)
- **WHEN** the reveal renders the leaderboard
- **THEN** the Current Season row is `["Current Season", "🥇 5", "🥈 2"]` (no 🥉)
- **AND** the All Time row uses medals only for the all-time top 2 among present players

#### Scenario: Seasons disabled retains 2-row leaderboard

- **GIVEN** the payload's `seasonStatus` field is absent (seasons disabled)
- **WHEN** the reveal renders the leaderboard
- **THEN** the table has 2 rows (names + scores)
- **AND** no "Current Season" / "All Time" labels appear
