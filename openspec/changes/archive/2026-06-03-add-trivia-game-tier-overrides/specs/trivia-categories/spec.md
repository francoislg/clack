## MODIFIED Requirements

### Requirement: save_question validates category

The `save_question` tool SHALL reject questions whose category is not in the active source pool. The active source pool SHALL be resolved by the cascade `season.categories → game.categories → categories.json`, with the following ordering rules:

1. When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, the active source pool is that season's `categories`.
2. Otherwise (seasons disabled or in a gap), the active source pool is the game's `categories` if `config.trivia.games[<game>].categories` is set.
3. Otherwise, the active source pool is `categories.json`.

#### Scenario: Valid category (seasons enabled)

- **GIVEN** seasons are enabled and `seasons.json#currentCategories` contains "Marine Biology"
- **WHEN** `save_question` is called with `category: "Marine Biology"`
- **THEN** the question is saved

#### Scenario: Category in baseline but not current season is rejected

- **GIVEN** seasons are enabled, `categories.json` contains "Sports", and `seasons.json#currentCategories` does NOT contain "Sports"
- **WHEN** `save_question` is called with `category: "Sports"`
- **THEN** the tool returns an error suggesting the use of `add_categories` (with `target: "current"` if the admin wants it just for this season)

#### Scenario: Game categories used when seasons disabled

- **GIVEN** seasons are disabled
- **AND** `config.trivia.games[<game>].categories` is `["History"]`
- **AND** `categories.json` also contains "Science"
- **WHEN** `save_question` is called with `game: <game>, category: "Science"`
- **THEN** the tool returns an error (the active pool is `["History"]` — the game tier wins over the global pool)

#### Scenario: Falls through to categories.json when neither season nor game set

- **GIVEN** seasons are disabled and the game has no `categories` field
- **WHEN** `save_question` is called with `category: "Sports"` and `categories.json` contains "Sports"
- **THEN** the question is saved

#### Scenario: Invalid category (seasons disabled, no game categories)

- **GIVEN** seasons are disabled and the game has no `categories` field
- **WHEN** `save_question` is called with `category: "Unknown Topic"` and it does not exist in `categories.json`
- **THEN** the tool returns an error suggesting the use of `add_categories`
