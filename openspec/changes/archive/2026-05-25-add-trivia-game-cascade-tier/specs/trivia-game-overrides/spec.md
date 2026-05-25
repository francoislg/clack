## ADDED Requirements

### Requirement: Per-game tier on the axis cascade

The Trivia plugin SHALL accept optional per-game axis overrides on every `TriviaGame` entry in the plugin config (`data/plugins/trivia/config.json` `games[]`). The supported per-game axis fields SHALL be the same five axes that already cascade at the workspace and season tiers:

- `answersFormat?: TriviaAnswersFormatWeights`
- `questionType?: TriviaQuestionTypeWeights`
- `freeformAnswerShape?: TriviaFreeformAnswerShapeWeights`
- `contexts?: TriviaContextEntry[]`
- `difficulty?: TriviaDifficultyConfig`

Each per-game field SHALL use the EXACT same shape and validation rules as the corresponding workspace-tier field. The full cascade SHALL be `slot → season → game → workspace → built-in default`, evaluated in that order on every per-game axis resolution. The per-game tier SHALL sit strictly between season and workspace.

For non-cascading workspace-only fields (`choices`, `seasons.{enabled,prompt}`, `offDays`), no per-game tier SHALL be introduced.

#### Scenario: Per-game override beats workspace default

- **GIVEN** the workspace `answersFormat` is `{ "boolean": 1, "choice": 0 }`
- **AND** game `main` has `answersFormat: { "boolean": 0, "choice": 1 }`
- **AND** seasons are disabled OR the current season has no `answersFormat` override
- **WHEN** `get_ideas(game: "main", ...)` is called
- **THEN** the resolver returns `{ "boolean": 0, "choice": 1 }` (per-game wins)

#### Scenario: Season override beats per-game override

- **GIVEN** game `main` has `answersFormat: { "choice": 1 }`
- **AND** the current season on game `main` has `answersFormat: { "boolean": 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the resolver returns the season's `{ "boolean": 1 }` (season tier > game tier)

#### Scenario: Slot override beats season override (unchanged)

- **GIVEN** the current season on game `main` has `answersFormat: { "boolean": 1 }` and `format.questions[0].answersFormat = { "choice": 1 }`
- **WHEN** `get_ideas(game: "main", slot: 0)` is called
- **THEN** the resolver returns the slot's `{ "choice": 1 }`

#### Scenario: No per-game override falls through to workspace

- **GIVEN** the workspace `answersFormat` is `{ "boolean": 1, "choice": 1 }`
- **AND** game `main` has no `answersFormat` field set
- **AND** no season / slot override applies
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the resolver returns the workspace value `{ "boolean": 1, "choice": 1 }`

#### Scenario: Per-game contexts uses weighted-random ordering

- **GIVEN** game `main` has `contexts: [{ name: "Quebec", weight: 5 }, { name: "International", weight: 1 }]`
- **AND** no season / slot override applies
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the resolver returns a `contextPriority` ordered by weighted-random sampling of the per-game contexts list

#### Scenario: Per-game difficulty merges per sub-field with workspace

- **GIVEN** the workspace `difficulty.freeform` is `{ easy: [2, 4], medium: [5, 6], hard: [7, 8], minimumThreshold: 2 }`
- **AND** game `main` has `difficulty.freeform = { hard: [8, 9] }` (per-game override of just freeform.hard)
- **AND** no season / slot override applies
- **WHEN** the resolver resolves freeform difficulty for game `main`
- **THEN** the resolved freeform ranges are `{ easy: [2, 4], medium: [5, 6], hard: [8, 9], minimumThreshold: 2 }` — per-game `hard` wins, other sub-fields fall through to workspace

### Requirement: parseTriviaGames validates per-game axis fields

The `parseTriviaGames` function SHALL accept the five optional axis fields (`answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`) on each entry. Per-field validation SHALL delegate to the existing workspace-tier validators (`validateAnswersFormatMap`, `validateQuestionTypeMap`, `validateFreeformAnswerShapeMap`, `validateContextsList`, `validateTriviaDifficultyMap`).

If a per-game axis field is present but malformed, the parser SHALL drop ONLY that field from the entry (the entry survives with the field set to `undefined`) and SHALL log a warning identifying the entry's index, the field name, and the validation failure. The entry's scheduling fields (`name`, `channel`, `questionCron`, `revealCron`, `timezone`, `enabled`) SHALL remain governed by their existing parser rules — a malformed axis field SHALL NOT take down the whole entry.

#### Scenario: Valid per-game answersFormat accepted

- **WHEN** `parseTriviaGames` parses `[{ name: "main", channel: "C1", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "UTC", answersFormat: { "boolean": 1, "choice": 2 } }]`
- **THEN** the parsed entry carries `answersFormat: { "boolean": 1, "choice": 2, "freeform": 0 }`

#### Scenario: Malformed per-game answersFormat drops only that field

- **WHEN** `parseTriviaGames` parses an entry with `answersFormat: { "boolean": 0, "choice": 0 }` (all-zero, invalid per workspace parser rules)
- **THEN** the entry is returned with the rest of its fields intact
- **AND** `answersFormat` is `undefined` on the parsed entry
- **AND** a warning is logged identifying the entry's index and the malformed `answersFormat` field

#### Scenario: Multiple malformed axis fields all dropped independently

- **WHEN** `parseTriviaGames` parses an entry with valid scheduling AND malformed `answersFormat` AND malformed `contexts`
- **THEN** the entry is returned with scheduling intact
- **AND** both `answersFormat` and `contexts` are `undefined`
- **AND** two warnings are logged (one per malformed field)

#### Scenario: Absent per-game fields treated as undefined

- **WHEN** `parseTriviaGames` parses an entry with no axis fields
- **THEN** the parsed entry has `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty` all `undefined`
- **AND** no warnings are logged for missing axis fields

### Requirement: Axis resolvers accept a per-game tier

Each axis resolver in `src/plugins/trivia/domain/` (`resolveAnswersFormat`, `resolveQuestionType`, `resolveFreeformAnswerShape`, `resolveContexts`, `resolveDifficultyRanges`) SHALL accept a `game: TriviaGame | null` parameter inserted between the existing `season`/`slot` and `config` parameters. Resolvers SHALL consult the game tier IF AND ONLY IF the slot and season tiers did not produce a value.

For axes that already perform whole-object replace (`answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`), the per-game value SHALL fully replace the workspace tier when present. For `difficulty`, the per-game value SHALL merge per sub-field on top of the workspace value (matching the existing season → workspace merge pattern).

Passing `game: null` to any resolver SHALL be equivalent to "no per-game override exists" — the cascade SHALL proceed directly from season (or slot) to workspace.

#### Scenario: Resolver signature includes game parameter

- **WHEN** any axis resolver is invoked
- **THEN** it accepts a `game: TriviaGame | null` parameter between season/slot and config

#### Scenario: game=null skips the per-game tier

- **WHEN** `resolveAnswersFormat(null, null, null, config)` is called with workspace `answersFormat = { "boolean": 1 }`
- **THEN** the resolver returns the workspace value `{ "boolean": 1 }`

#### Scenario: game with no axis override falls through

- **GIVEN** a `TriviaGame` entry with no `answersFormat` field
- **WHEN** `resolveAnswersFormat(null, null, game, config)` is called
- **THEN** the cascade falls through to the workspace `answersFormat` value
