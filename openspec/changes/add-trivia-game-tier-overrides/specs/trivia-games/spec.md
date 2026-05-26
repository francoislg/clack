## ADDED Requirements

### Requirement: format axis at per-game tier

The Trivia plugin's runtime configuration SHALL accept an optional `format: SeasonFormat` field on each entry of `config.trivia.games[]` (per-game tier). When present, the field MUST conform to the same shape and invariants enforced for the season-tier `format`:

```
format: {
  questions: Array<{
    label?: string,
    categories?: string[],
    answersFormat?: Record<"boolean" | "choice" | "freeform", number>,
    questionType?: Record<"fact" | "topical", number>,
    freeformAnswerShape?: Record<TriviaFreeformAnswerShape, number>,
    contexts?: Array<{ name: string; weight?: number }>,
    difficulty?: TriviaDifficultyConfig,
    difficultyRatio?: TriviaDifficultyRatioConfig
  }>
}
```

`parseTriviaGames` SHALL validate the field by delegating to the same `validateFormat` function used by `upsert_season`. When validation fails, the field SHALL be dropped (only the invalid field — the rest of the game entry survives) with a logged issue naming the field and the validator's error message. This matches the lenient axis-bag policy (`parseTriviaAxisBag`) and contrasts with the strict drop-the-whole-entry policy used for scheduling fields like `name` / `channel` / `cron` / `timezone` / `enabled`.

Resolution SHALL place the per-game tier between season and the single-question fallback. The effective format for a question-cron fire SHALL be the first present tier in the order: `season.format → game.format → (single-question fallback)`. When neither season nor game provides a `format`, the cron fire SHALL post a single question (pre-format behavior).

`list_games` SHALL surface each entry's `format` field IF AND ONLY IF the entry has one set.

#### Scenario: Game without format inherits the historical single-question behavior

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", ... }` with no `format` and no active season with a `format`
- **WHEN** the question cron fires for game `main`
- **THEN** a single question is posted (pre-format behavior unchanged)

#### Scenario: Game with format posts one question per slot

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", format: { questions: [{ label: "Warmup" }, { label: "Choice", answersFormat: { choice: 1 } }] }, ... }` and no active season with a `format`
- **WHEN** the question cron fires for game `main`
- **THEN** exactly two questions are posted in slot order

#### Scenario: Season format wins over game format

- **GIVEN** game `main` has `format: { questions: [{}] }` (one slot) and the active season has `format: { questions: [{}, {}, {}] }` (three slots)
- **WHEN** the question cron fires for game `main`
- **THEN** three questions are posted (season tier wins per the standard cascade)

#### Scenario: Invalid game format field dropped at load

- **GIVEN** `config.trivia.games[0].format.questions` is `[]` (empty)
- **WHEN** the config is loaded
- **THEN** the entry survives in the parsed result but with no `format` field
- **AND** a logged issue names the field `trivia.games[0].format` and the validator error `format.questions must be a non-empty array`

#### Scenario: list_games surfaces per-game format when set

- **GIVEN** game `main` has `format: { questions: [{ label: "Warmup" }] }`
- **WHEN** `list_games` is called
- **THEN** the `main` entry includes a `format` field matching the stored value

#### Scenario: list_games omits format when absent

- **GIVEN** game `main` has no `format`
- **WHEN** `list_games` is called
- **THEN** the `main` entry has no `format` key

### Requirement: categories axis at per-game tier

The Trivia plugin's runtime configuration SHALL accept an optional `categories: string[]` field on each entry of `config.trivia.games[]` (per-game tier). When present, the field MUST be a non-empty array of strings, deduped (preserving first-occurrence order) by `parseTriviaGames`.

Resolution for a question-cron fire SHALL follow the cascade: `slot.categories → season.categories → game.categories → categories.json`. The game tier sits between the active season and the global `data/plugins/trivia/categories.json` pool. The `save_question validates category` requirement on the `trivia-categories` capability SHALL consult the game tier as part of its active-source-pool resolution.

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

Resolution SHALL place the per-game tier directly below the season tier. The effective theme for opener / finale prompt construction SHALL be the first present tier in the order: `season.theme → game.theme → (no theme)`. When neither tier provides a `theme`, no theme line is rendered (pre-theme behavior).

`list_games` SHALL surface each entry's `theme` field IF AND ONLY IF the entry has one set.

#### Scenario: Game theme used when no season theme is set

- **GIVEN** game `main` has `theme: "Channel Lore Trivia"` and no active season (or active season has no `theme`)
- **WHEN** an opener or finale is rendered for game `main`
- **THEN** the rendered text references `"Channel Lore Trivia"` as the theme

#### Scenario: Season theme wins over game theme

- **GIVEN** game `main` has `theme: "Channel Lore Trivia"` and the active season has `theme: "Halloween Spooktacular"`
- **WHEN** an opener or finale is rendered for game `main`
- **THEN** the rendered text references `"Halloween Spooktacular"`

#### Scenario: Blank game theme field dropped at load

- **GIVEN** `config.trivia.games[0].theme` is `"   "` (whitespace only)
- **WHEN** the config is loaded
- **THEN** the entry survives in the parsed result but with no `theme` field
- **AND** a logged issue names the field `trivia.games[0].theme`

#### Scenario: list_games surfaces per-game theme when set

- **GIVEN** game `main` has `theme: "Channel Lore Trivia"`
- **WHEN** `list_games` is called
- **THEN** the `main` entry includes `theme: "Channel Lore Trivia"`
