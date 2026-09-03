## MODIFIED Requirements

### Requirement: categories axis at per-game tier

The Trivia plugin's runtime configuration SHALL accept an optional `categories: string[]` field on each entry of `config.trivia.games[]` (per-game tier). When present, the field MUST be a non-empty array of strings, deduped (preserving first-occurrence order) by `parseTriviaGames`.

Resolution for a question-cron fire SHALL follow the cascade: `slot.categories → phase.categories → season.categories → game.categories → categories.json`. The active phase sits between the slot and its own season, matching the `seasonPhase` placement in the axis cascade. The game tier sits between the active season and the global `data/plugins/trivia/categories.json` pool. The `save_question validates category` requirement on the `trivia-categories` capability SHALL consult the game tier as part of its active-source-pool resolution.

The resolver SHALL take a `CascadeContext` rather than positional tier arguments, so the phase tier does not become an additional parameter threaded through every call site. `CategorySource` SHALL gain a `"phase"` member.

`list_games` SHALL surface each entry's `categories` field IF AND ONLY IF the entry has one set.

#### Scenario: Game categories override the global pool when no season is active

- **GIVEN** `categories.json` contains `["Science", "History", "Sports"]`
- **AND** `config.trivia.games[0]` is `{ name: "main", categories: ["History"] }`
- **AND** seasons are disabled (or no active season)
- **WHEN** `save_question` is called with `game: "main", category: "Science"`
- **THEN** the tool rejects the call with an error suggesting `add_categories` (the resolved pool for the game is `["History"]`)

#### Scenario: Season categories win over game categories

- **GIVEN** game `main` has `categories: ["History"]`
- **AND** the active season has `categories: ["Marine Biology"]`
- **WHEN** `save_question` is called with `game: "main", category: "History"`
- **THEN** the tool rejects the call (the active source pool is the season's `["Marine Biology"]`)

#### Scenario: Phase categories win over season categories

- **GIVEN** the active season has `categories: ["Marine Biology"]`
- **AND** its active phase has `categories: ["Deep Sea Horrors"]`
- **WHEN** the active pool is resolved
- **THEN** the pool is `["Deep Sea Horrors"]` and the reported source is `"phase"`

#### Scenario: Slot categories still win over phase categories

- **GIVEN** the active phase has `categories: ["Deep Sea Horrors"]`
- **AND** the resolved slot has `categories: ["Trilobites"]`
- **WHEN** the active pool is resolved
- **THEN** the pool is `["Trilobites"]` and the reported source is `"slot"`

#### Scenario: Invalid game categories field dropped at load

- **GIVEN** `config.trivia.games[0].categories` is `[]` or contains only empty strings
- **WHEN** the config is loaded
- **THEN** the entry survives in the parsed result but with no `categories` field
- **AND** a logged issue names the field `trivia.games[0].categories`

#### Scenario: list_games surfaces per-game categories when set

- **GIVEN** game `main` has `categories: ["History"]`
- **WHEN** `list_games` is called
- **THEN** the `main` entry includes `categories: ["History"]`

### Requirement: theme axis at per-game tier

The Trivia plugin's runtime configuration SHALL accept an optional `theme: string` field on each entry of `config.trivia.games[]` (per-game tier). When present, the value MUST be non-empty after trim. `parseTriviaGames` SHALL trim the value before storing it. When `theme` is present but not a string, or is blank after trim, the field SHALL be dropped (only the invalid field) with a logged issue — matching the lenient axis-bag policy.

Resolution SHALL place the per-game tier directly below the season tier, and the active phase directly above it. The effective theme for opener / finale prompt construction SHALL be the first present tier in the order: `phase.theme → season.theme → game.theme → (no theme)`. When no tier provides a `theme`, no theme line is rendered (pre-theme behavior).

`list_games` SHALL surface each entry's `theme` field IF AND ONLY IF the entry has one set.

#### Scenario: Game theme used when no season theme is set

- **GIVEN** game `main` has `theme: "Channel Lore Trivia"` and no active season (or active season has no `theme`)
- **WHEN** an opener or finale is rendered for game `main`
- **THEN** the rendered text references `"Channel Lore Trivia"` as the theme

#### Scenario: Season theme wins over game theme

- **GIVEN** game `main` has `theme: "Channel Lore Trivia"` and the active season has `theme: "Halloween Spooktacular"`
- **WHEN** an opener or finale is rendered for game `main`
- **THEN** the rendered text references `"Halloween Spooktacular"`

#### Scenario: Phase theme wins over season theme

- **GIVEN** the active season has `theme: "Halloween Spooktacular"` and its active phase has `theme: "The Gauntlet"`
- **WHEN** an opener or finale is rendered
- **THEN** the rendered text references `"The Gauntlet"`

#### Scenario: Blank game theme field dropped at load

- **GIVEN** `config.trivia.games[0].theme` is `"   "` (whitespace only)
- **WHEN** the config is loaded
- **THEN** the entry survives in the parsed result but with no `theme` field
- **AND** a logged issue names the field `trivia.games[0].theme`

#### Scenario: list_games surfaces per-game theme when set

- **GIVEN** game `main` has `theme: "Channel Lore Trivia"`
- **WHEN** `list_games` is called
- **THEN** the `main` entry includes `theme: "Channel Lore Trivia"`
