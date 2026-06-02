## MODIFIED Requirements

### Requirement: Season-finale reveal layout

When `seasons.enabled` is `true` AND `seasonStatus.isLastFireOfSeason` is `true`, the reveal flow SHALL render a dedicated finale layout in place of the normal leaderboard table, in this order:

1. The per-question verdict blocks for the round just revealed (as in any reveal).
2. A **Season Winners** section introduced by a transition line (e.g. "And now, the season's winners!"). It SHALL present the final current-season standings as a vertical ranked list: the top three DISTINCT `currentSeasonCorrect` values rendered as `🥇 First place`, `🥈 Second place`, `🥉 Third place` lines (players tied on a value SHALL share that place and medal), each line naming the player(s) and their points (`currentSeasonCorrect`). The place labels (`First place` / `Second place` / `Third place`) SHALL be sourced from the trivia i18n dictionary and rendered in the configured language — they SHALL NOT be fixed English literals; the medal glyphs and `String(...)` point values are language-neutral.
3. A one-line **participation tail** listing every remaining participant (below the podium) with their points, comma-separated; the player(s) at the 4th distinct value SHALL carry the `🎀` ribbon. Players with zero current-season participation SHALL be omitted. The tail's label (e.g. `Participation:`) SHALL be sourced from the trivia i18n dictionary and rendered in the configured language.
4. An **All-Time table** — rendered IF AND ONLY IF `seasonStatus.hasPriorSeasons` is `true` AND `showAllTimeRow` is `true` — introduced by a transition line (e.g. "And the all-time leaderboard:"). It SHALL be a Slack `table` with a names-header row and an `All Time` row of `String(totalCorrect)`, columns ordered by `totalCorrect` descending, with medals following the unified dense-rank rule. The `All Time` row label SHALL be the configured-language dictionary value (per "Reveal leaderboard labels are localized via the trivia dictionary"). When the gate fails (single season, or `allTimeRow` hides it), the All-Time table SHALL be omitted.
5. A closer line (e.g. "Thanks for playing, see you next season!"). The finale SHALL NOT preview the next season's slug, even when `seasonStatus.newSeasonStarted` is present.

"pts" SHALL mean `currentSeasonCorrect` — no separate scoring concept is introduced. Season-end rollover (stamping `endedAt` on the closing season and, when no continuation is queued, creating a new starter season) SHALL happen INSIDE `process_reveal_answers` before the tool returns; the renderer SHALL NOT call `upsert_season` as a follow-up. The rollover outcome SHALL be reported in `seasonStatus.seasonClosed` and `seasonStatus.newSeasonStarted` for informational use.

The transition and closer lines (steps 2, 4, 5) are free prose authored by Claude and SHALL continue to be translated via the LANGUAGE directive; only the fixed structural labels (place labels, participation label, `All Time` row label) are pre-localized from the dictionary. When the configured language is English the dictionary values equal the prior literals, so finale output is byte-identical to the pre-change behavior.

When `seasonStatus.isLastFireOfSeason` is `false` (or `seasonStatus` is absent), no finale layout is rendered and the normal leaderboard table (per "Seasons leaderboard row composition") is used.

#### Scenario: Finale renders podium, participation tail, and all-time table

- **GIVEN** `seasonStatus.isLastFireOfSeason` is `true`, `hasPriorSeasons` is `true`, and `showAllTimeRow` is `true`
- **WHEN** the reveal flow completes
- **THEN** the post contains a Season Winners podium with `🥇`/`🥈`/`🥉` place lines naming players and their `currentSeasonCorrect` points
- **AND** a one-line participation tail with the 4th distinct value carrying `🎀`
- **AND** an All-Time `table` with medals on the `All Time` row
- **AND** a "see you next season" style closer that does not preview the next season's slug
- **AND** `process_reveal_answers` already stamped `endedAt` before returning (no `upsert_season` follow-up)

#### Scenario: Finale labels localized in a French workspace

- **GIVEN** the configured language is French and `seasonStatus.isLastFireOfSeason` is `true`
- **WHEN** the finale layout is built
- **THEN** the podium place labels render in French (e.g. `Première place`, `Deuxième place`, `Troisième place`) sourced from the dictionary
- **AND** the participation-tail label and `All Time` row label render in French
- **AND** the medal glyphs and `String(...)` point values are unchanged

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
