# trivia-seasons — delta for add-trivia-game-wind-down

## MODIFIED Requirements

### Requirement: trivia-check instruction advertises games and timeline management

The `trivia-check` instruction registered by the Trivia plugin SHALL include guidance directing Claude that:

1. Every per-game trivia tool requires a `game: string` argument.
2. In reactive sessions (DM / mention / reaction), Claude SHALL resolve the game from the channel via the channel-inference helper (or its conceptual equivalent — checking `config.trivia.games[]` for an entry whose `channel` matches the session's channel ID).
3. Claude MAY call `list_games` to discover available games.
4. The plugin's user-facing output SHALL NOT mention `game` slugs to end-users unless an admin explicitly asks; the slug is an internal coordination token between Claude and the tools.

When `seasons.enabled` is `true`, the instruction SHALL additionally include guidance for the season-management tools (`upsert_season(game, ...)`, `delete_season(game, slug)`, `list_seasons(game)`, `add_categories({ game, target: "<slug>" })`, `remove_categories({ game, target: "<slug>" })`), the rule that `categories` on `upsert_season` REPLACES the baseline (for themed seasons), and the semantic that each game's timeline is independent.

When `seasons.enabled` is `false`, the instruction SHALL NOT include the season-tool guidance.

#### Scenario: Instruction includes game-arg guidance

- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text references the `game` argument required by per-game tools
- **AND** the resolved text directs Claude to use channel inference (or `list_games`) to determine the game in reactive sessions
- **AND** the resolved text directs Claude not to surface the slug to end-users

#### Scenario: Instruction includes timeline guidance when seasons enabled

- **GIVEN** `seasons.enabled` is `true`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text references `upsert_season`, `delete_season`, and `list_seasons` by name with their `game` argument
- **AND** each game's timeline is described as independent
- **AND** the instruction does NOT reference `start_new_season` (obsolete name) or `end_season` (a reveal-flow / management-topic tool, not timeline guidance)

#### Scenario: Instruction omits timeline guidance when seasons disabled

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text does NOT reference any timeline tools

### Requirement: Season-finale reveal layout

When `seasons.enabled` is `true` AND `seasonStatus.isLastFireOfSeason` is `true`, the reveal flow SHALL render a dedicated finale layout in place of the normal leaderboard table, in this order:

1. The per-question verdict blocks for the round just revealed (as in any reveal).
2. A **Season Winners** section introduced by a transition line (e.g. "And now, the season's winners!"). It SHALL present the final current-season standings as a vertical ranked list: the top three DISTINCT `currentSeasonCorrect` values rendered as `🥇 First place`, `🥈 Second place`, `🥉 Third place` lines (players tied on a value SHALL share that place and medal), each line naming the player(s) and their points (`currentSeasonCorrect`). The place labels (`First place` / `Second place` / `Third place`) SHALL be sourced from the trivia i18n dictionary and rendered in the configured language — they SHALL NOT be fixed English literals; the medal glyphs and `String(...)` point values are language-neutral.
3. A one-line **participation tail** listing every remaining participant (below the podium) with their points, comma-separated; the player(s) at the 4th distinct value SHALL carry the `🎀` ribbon. Players with zero current-season participation SHALL be omitted. The tail's label (e.g. `Participation:`) SHALL be sourced from the trivia i18n dictionary and rendered in the configured language.
4. An **All-Time table** — rendered IF AND ONLY IF `seasonStatus.hasPriorSeasons` is `true` AND `showAllTimeRow` is `true` — introduced by a transition line (e.g. "And the all-time leaderboard:"). It SHALL be a Slack `table` with a names-header row and an `All Time` row of `String(totalCorrect)`, columns ordered by `totalCorrect` descending, with medals following the unified dense-rank rule. The `All Time` row label SHALL be the configured-language dictionary value (per "Reveal leaderboard labels are localized via the trivia dictionary"). When the gate fails (single season, or `allTimeRow` hides it), the All-Time table SHALL be omitted.
5. A closer line. When the `end_season` result did NOT carry `gameDisabled: true`, the closer is the season-handoff style (e.g. "Thanks for playing, see you next season!") and SHALL NOT preview the next season's slug, even when the result carried `newSeasonStarted`. When the `end_season` result carried `gameDisabled: true` (the game wound down via `disableAfterRound`), the closer SHALL be a series wrap — the chapter closes for good, with NO "see you next season" and NO next-season preview.

"pts" SHALL mean `currentSeasonCorrect` — no separate scoring concept is introduced. Season-end close (stamping `endedAt` on the closing season and resolving the successor policy — promote a queued season, create a continuation, or wind the game down) SHALL be performed by the renderer flow calling `end_season` after `compute_answers` (which reports `seasonStatus` but performs no rollover, per `trivia-reveal-processor`); the renderer SHALL NOT call `upsert_season` as a follow-up. The close outcome SHALL be reported in the `end_season` result (`seasonClosed`, optional `newSeasonStarted`, optional `gameDisabled`) for informational use.

The transition and closer lines (steps 2, 4, 5) are free prose authored by Claude and SHALL continue to be translated via the LANGUAGE directive; only the fixed structural labels (place labels, participation label, `All Time` row label) are pre-localized from the dictionary. When the configured language is English the dictionary values equal the prior literals, so finale output is byte-identical to the pre-change behavior.

When `seasonStatus.isLastFireOfSeason` is `false` (or `seasonStatus` is absent), no finale layout is rendered and the normal leaderboard table (per "Seasons leaderboard row composition") is used.

#### Scenario: Finale renders podium, participation tail, and all-time table

- **GIVEN** `seasonStatus.isLastFireOfSeason` is `true`, `hasPriorSeasons` is `true`, and `showAllTimeRow` is `true`
- **WHEN** the reveal flow completes
- **THEN** the post contains a Season Winners podium with `🥇`/`🥈`/`🥉` place lines naming players and their `currentSeasonCorrect` points
- **AND** a one-line participation tail with the 4th distinct value carrying `🎀`
- **AND** an All-Time `table` with medals on the `All Time` row
- **AND** a "see you next season" style closer that does not preview the next season's slug
- **AND** `end_season` stamped `endedAt` before `submit_response` (no `upsert_season` follow-up)

#### Scenario: Wound-down finale renders a series-wrap closer

- **GIVEN** `seasonStatus.isLastFireOfSeason` is `true` and the `end_season` result carried `gameDisabled: true`
- **WHEN** the reveal flow completes
- **THEN** the finale closer is a series wrap with no "see you next season" phrasing and no next-season preview

#### Scenario: Finale labels localized in a French workspace

- **GIVEN** the configured language is French and `seasonStatus.isLastFireOfSeason` is `true`
- **WHEN** the finale layout is built
- **THEN** the podium place labels render in French (e.g. `Première place`, `Deuxième place`, `Troisième place`) sourced from the dictionary

### Requirement: Season close stamps the effective teams roster and scoring mode

When a season ends (via `end_season` or the season-end path), and teams mode was effectively ON for the game, the system SHALL stamp the effective roster and effective `teamsScoring` onto the ending `SeasonEntry` in `seasons.json` as a single `teamsStamp: { teams, teamsScoring }` object — DISTINCT from the season-TIER config fields (`SeasonEntry.teams` etc. are one cascade tier's input; the stamp is the resolved output frozen for history, so a season-tier roster on an ended season where teams mode was OFF is never mistaken for team history). Ended seasons SHALL be scored from their stamp, immune to later config edits; the live season SHALL always be scored from live effective config. `teamsStamp` is OPTIONAL on `SeasonEntry` (graceful reader — legacy rows simply carry no team history). The stamp SHALL be written on the wind-down branch too (`disableAfterRound` games close their season like any other).

#### Scenario: Stamp written at close when teams were on

- **WHEN** a season with effective `teamsEnabled: true` is closed
- **THEN** the ending `SeasonEntry` persists the effective roster and scoring mode as of close time

#### Scenario: Stamp written when the season closes via wind-down

- **GIVEN** a game with `disableAfterRound: true` and effective `teamsEnabled: true`
- **WHEN** `end_season` closes the season through the wind-down branch (no successor created, game disabled)
- **THEN** the ending `SeasonEntry` persists the effective roster and scoring mode as of close time, same as a normal close

#### Scenario: No stamp when teams were off

- **WHEN** a season with teams mode off is closed
- **THEN** no teams fields are stamped on the ending entry

#### Scenario: Later config edits do not rewrite history

- **WHEN** an admin changes the game roster or `teamsScoring` after a season closed
- **THEN** the ended season's team scores (as used by all-time) are computed from its stamp, unchanged

#### Scenario: Legacy season entries load unchanged

- **WHEN** `seasons.json` contains entries without stamped teams fields
- **THEN** they load without error and contribute no team history
