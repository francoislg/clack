## MODIFIED Requirements

### Requirement: Season rollover happens inside the tool

When `seasons.enabled === true` AND the tool's internal `check_season_status` computation reports `isLastFireOfSeason: true`, the tool SHALL perform the season-end rollover inline, before returning. Rollover consists of:

1. Stamping `endedAt = Date.now()` on the closing season entry (idempotent — no-op if `endedAt` is already set).
2. If no future season entry exists in this game's `seasons.json` with `startedAt > now`, creating a continuation season entry. The continuation season SHALL inherit `answersFormat`, `questionType`, `contexts`, and `format` from the closing season (deep copies of each field; absent fields stay absent). The continuation SHALL NOT inherit the closing season's **season-level** `categories`: the continuation entry SHALL omit the `categories` field entirely, so its category pool resolves via the cascade (`game.categories → global categories.json`). Slot-level `format.questions[i].categories` IS preserved as part of the deep-copied `format` (it is structural slot composition, not the season's theme). The continuation's `slug` SHALL be deterministically derived (e.g. `season-YYYY-MM` for the next month). The continuation's `startedAt` SHALL be `Date.now()` and `expectedEndAt` SHALL be end-of-current-UTC-month.

The continuation's reset of season-level `categories` to cascade-inheritance encodes the principle that machine-generated config inherits while human-authored config is explicit: a themed season is a temporary, one-month deviation, so absent an explicitly staged future season, the continuation reverts to the game/global baseline rather than silently re-baking the theme forward. The structural fields (`answersFormat`, `questionType`, `contexts`, `format`) still carry forward because they define how the game runs, not what it is themed about. Dropping `categories` can never produce an empty pool — the cascade terminates at the always-present global `categories.json`. Staged future seasons (entries with `startedAt > now` already on the timeline at the moment of rollover) SHALL NOT be replaced or augmented — admin intent overrides inheritance.

The tool SHALL report the outcome via `seasonStatus.seasonClosed` (true iff this run stamped `endedAt`) and, when a continuation was created, `seasonStatus.newSeasonStarted: { slug, expectedEndAt }`. The tool SHALL identify the season MVP (player at index 0 of the current-season-ordered leaderboard) and include them in `seasonStatus.mvp` for the renderer.

When `isLastFireOfSeason` is `false`, the tool SHALL NOT perform any rollover, SHALL NOT mutate any season entry, and SHALL set `seasonStatus.seasonClosed: false` with no `newSeasonStarted` field.

#### Scenario: Last-fire reveal closes the season inline

- **GIVEN** `seasons.enabled` is `true`, the current season's `expectedEndAt` makes today its last fire, and no future season is queued
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** before the call returns, the closing season's entry in `games/main/seasons.json` has `endedAt` stamped to a value close to `Date.now()`
- **AND** a new season entry is appended with a fresh slug, `startedAt` close to `Date.now()`, and `expectedEndAt` set to end-of-current-UTC-month
- **AND** the returned `seasonStatus.seasonClosed` is `true`
- **AND** `seasonStatus.newSeasonStarted` references the new entry's slug and expectedEndAt

#### Scenario: Auto-continuation resets season-level categories to cascade

- **GIVEN** the closing season's `categories` is `["Marine Biology", "Cephalopods", "Tides"]` (a themed pool that differs from the global baseline)
- **AND** the game's stored config has `categories: ["History", "Geography"]`
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry has NO `categories` field
- **AND** the next question-cron fire for this game draws its category pool from the cascade — the game's `["History", "Geography"]` (or, if the game has none, the global `categories.json`), NOT the closing season's themed list

#### Scenario: Auto-continuation inherits questionType from the closing season

- **GIVEN** the closing season's `questionType` is `{ choice: 1 }`
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry's `questionType` is a deep copy of `{ choice: 1 }`

#### Scenario: Auto-continuation inherits format and preserves slot-level categories

- **GIVEN** the closing season has `format: { questions: [{ label: "GK 1" }, { label: "Science Choice", answersFormat: { choice: 1 }, categories: ["Science"] }] }`
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry's `format` is a deep copy of the closing season's `format`
- **AND** the continuation's `format.questions[1].categories` is still `["Science"]` (slot-level categories survive even though season-level categories were dropped)
- **AND** the next question-cron fire for this game posts 2 questions matching the inherited slot structure

#### Scenario: Auto-continuation absent fields stay absent

- **GIVEN** the closing season has no `questionType` field and no `format` field
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry has no `questionType` field and no `format` field
- **AND** the new entry has no `categories` field (resolving via the cascade)
