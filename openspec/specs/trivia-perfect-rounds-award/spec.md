# trivia-perfect-rounds-award Specification

## Purpose
TBD - created by archiving change add-trivia-perfect-rounds-award. Update Purpose after archive.
## Requirements
### Requirement: Perfect-rounds award cascading knob

The Trivia plugin SHALL expose an optional `perfectRoundsAward` knob of shape `{ enabled: boolean }` on three configuration tiers — workspace (`TriviaConfig`), game (`TriviaGame`), and season (`SeasonEntry`). The knob SHALL resolve through a dedicated resolver (`resolvePerfectRoundsAward`) with whole-value replace per tier in the cascade order `season → game → workspace → built-in default`. The built-in default SHALL be `{ enabled: false }`.

The knob SHALL NOT be a `CascadeAxes` member: it has no slot tier, and it is never rolled by `get_ideas` nor stamped by `save_question`. Each tier's value SHALL be validated by a zod validator; a graceful reader SHALL treat an absent or malformed value as unset at that tier.

When the resolved value is `{ enabled: false }` at every tier (i.e. the default), season-finale behavior SHALL be byte-identical to trivia without this feature.

#### Scenario: Season overrides game overrides workspace

- **WHEN** `perfectRoundsAward` is set at more than one tier
- **THEN** the resolver returns the season value if present, else the game value if present, else the workspace value if present, else `{ enabled: false }`

#### Scenario: Default is off

- **WHEN** no tier sets `perfectRoundsAward`
- **THEN** the resolver returns `{ enabled: false }` and the season finale renders no bonus medal

#### Scenario: Malformed persisted value is ignored gracefully

- **WHEN** a tier's persisted `perfectRoundsAward` fails validation
- **THEN** that tier is treated as unset (the reader does not throw and does not wipe other state)

### Requirement: Season-wide perfect-round aggregation

At the season finale (`process_reveal_answers` when `seasonStatus.isLastFireOfSeason` is true) AND only when the resolved `perfectRoundsAward.enabled` is true, the reveal processor SHALL tally each player's perfect rounds across the current season.

A "fire" SHALL be the set of revealed questions (`processedAt` set) belonging to the current season (`season === seasonStatus.currentSlug`) that share a `batchId`. A question with an undefined `batchId` SHALL form its own singleton fire. A player SHALL earn one perfect round for a fire IFF the fire contains at least `PERFECT_ROUND_MIN_QUESTIONS` (3) questions AND the player answered every question in that fire correctly. The same dedupe and exclusion rules as the per-fire round summary SHALL apply: at most one credit per (question, player), and synthetic team owner keys (`team:` prefix) SHALL be excluded so the tally is an individual honor.

The champion SHALL be the player(s) with the maximum perfect-round count. Ties SHALL all be returned. The tally SHALL use data already loaded for the leaderboard (questions and scored answers); it SHALL NOT introduce new persistence.

#### Scenario: Tally counts only ≥3-question clean sweeps

- **WHEN** a player answered every question correctly on a 3-question fire and on a separate 5-question fire, and swept a 2-question fire
- **THEN** their season perfect-round count is 2 (the 2-question fire does not qualify)

#### Scenario: Legacy questions without batchId never form a perfect round

- **WHEN** revealed questions in the season have an undefined `batchId`
- **THEN** each is treated as a singleton fire and contributes no perfect round to any player

#### Scenario: Team owner keys are excluded

- **WHEN** the season ran in `byTeam` answering mode
- **THEN** synthetic `team:<name>` rows are excluded from the perfect-round tally (the award reflects individual players only)

### Requirement: Perfect-rounds champion finale payload

When the perfect-rounds aggregation runs and the maximum count is at least 1, `process_reveal_answers` SHALL include `seasonStatus.perfectRoundsChampion` of shape `{ userIds: string[]; count: number }`, where `userIds` lists every player tied at the maximum and `count` is that maximum. The field SHALL be omitted when the knob is disabled, when it is not the last fire of the season, or when the maximum count is 0.

#### Scenario: Champion present with a clear leader

- **WHEN** one player has the most perfect rounds (count ≥ 1) at the finale and the knob is enabled
- **THEN** `seasonStatus.perfectRoundsChampion` is `{ userIds: [that player], count: <n> }`

#### Scenario: Champion present with ties

- **WHEN** several players tie for the most perfect rounds at the finale
- **THEN** `seasonStatus.perfectRoundsChampion.userIds` contains every tied player and `count` is their shared value

#### Scenario: Every participant tied is still surfaced

- **WHEN** every participating player has the same (non-zero) perfect-round count
- **THEN** `perfectRoundsChampion` still lists all of them (the award is not suppressed for lack of a standout)

#### Scenario: Omitted when nobody swept a fire

- **WHEN** no player earned any perfect round during the season
- **THEN** `seasonStatus.perfectRoundsChampion` is absent

#### Scenario: Omitted when disabled or not the finale

- **WHEN** the knob is disabled OR the reveal is not the season's last fire
- **THEN** `seasonStatus.perfectRoundsChampion` is absent regardless of any perfect rounds played

### Requirement: Finale bonus-medal rendering

The season-finale prompt (the SEASON FINALE LAYOUT in the scheduled reveal prompt and the `FINALE_TONE_CONTENT` topic instruction) SHALL direct Claude to render a bonus 🎖️ medal for `seasonStatus.perfectRoundsChampion` when the field is present. The medal SHALL use the 🎖️ glyph (distinct from the podium's 🥇🥈🥉), name the champion(s) per the payload's `tagPlayers` mention policy, and list all tied players together. When `perfectRoundsChampion` is absent, the prompt SHALL render no bonus-medal line. The bonus medal SHALL NOT alter the points podium, the participation tail, the leaderboard table, or any scoring.

#### Scenario: Prompt renders the bonus medal when the champion is present

- **WHEN** the finale payload includes `perfectRoundsChampion`
- **THEN** the reveal prompt instructs Claude to award a 🎖️ bonus medal to those player(s), separate from the points podium

#### Scenario: Prompt renders nothing when the champion is absent

- **WHEN** the finale payload has no `perfectRoundsChampion`
- **THEN** the reveal prompt produces no bonus-medal line and the finale is otherwise unchanged

### Requirement: Admin surfacing and configuration

The resolved and per-tier `perfectRoundsAward` values SHALL be surfaced by `list_games` (per-game and workspace defaults) and `list_seasons`. The knob SHALL be settable at the workspace tier via `set_workspace_config`, at the game tier via `upsert_game`, and at the season tier via `upsert_season`, each with omit-to-keep / null-to-clear semantics consistent with the other structural knobs.

#### Scenario: list_games reports the setting

- **WHEN** `perfectRoundsAward` is set on a game or workspace
- **THEN** `list_games` includes it in the game's overrides and/or the workspace defaults

#### Scenario: upsert clears the setting

- **WHEN** `upsert_game` (or `upsert_season` / `set_workspace_config`) is called with `perfectRoundsAward: null`
- **THEN** the tier's value is cleared and resolution falls through to the next lower tier

