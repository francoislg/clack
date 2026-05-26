## ADDED Requirements

### Requirement: liveAnswersVisible field on TriviaGame

`TriviaGame` (entries in `config.trivia.games[]`) SHALL accept an optional `liveAnswersVisible: boolean` field. When present, this value participates in the `liveAnswersVisible` cascade resolved at `post_questions` time (cascade order: `slot → season → game → workspace → default(true)`).

The field SHALL be parsed by `parseTriviaGames` with the following rules:

- Absence is valid — the cascade resolution falls through to workspace config and ultimately to the `true` default.
- Non-boolean values (strings, numbers, null) SHALL be rejected with a logged warning naming the game and the violating value, and the entry's `liveAnswersVisible` SHALL be treated as absent.
- The value SHALL be exposed on the `TriviaGame` shape returned by `parseTriviaGames` so that the cascade resolver can read it.

#### Scenario: Absent field cascades to workspace config

- **GIVEN** `config.trivia.games[]` has `{ name: "main", channel: "C123", ... }` (no `liveAnswersVisible` field)
- **AND** `config.trivia.liveAnswersVisible: true`
- **WHEN** `post_questions` resolves the cascade for a question in this game (no season / slot override)
- **THEN** the stamped value is `true` (workspace default carries through)

#### Scenario: Game-level false beats workspace default

- **GIVEN** `config.trivia.games[]` has `{ name: "main", liveAnswersVisible: false, ... }`
- **AND** `config.trivia.liveAnswersVisible: true`
- **AND** no season / slot override
- **WHEN** `post_questions` resolves the cascade for a question in `main`
- **THEN** the stamped value is `false`

#### Scenario: Non-boolean field is rejected

- **GIVEN** `config.trivia.games[]` has `{ name: "main", liveAnswersVisible: "false", ... }` (string, not boolean)
- **WHEN** `parseTriviaGames` runs
- **THEN** a warning is logged identifying the game name and the invalid type
- **AND** the parsed game has no `liveAnswersVisible` field (treated as absent)

#### Scenario: list_games surfaces the field when set

- **GIVEN** a game with `liveAnswersVisible: false`
- **WHEN** `list_games` runs
- **THEN** the per-game entry in its response includes `liveAnswersVisible: false`

#### Scenario: list_games omits the field when absent

- **GIVEN** a game without an explicit `liveAnswersVisible` value
- **WHEN** `list_games` runs
- **THEN** the per-game entry does NOT include a `liveAnswersVisible` field (no default-injection at read time)

### Requirement: revealResponses field on TriviaGame

`TriviaGame` (entries in `config.trivia.games[]`) SHALL accept an optional `revealResponses: "no" | "just-correctness" | "yes"` field. When present, this value participates in the `revealResponses` cascade resolved at `post_questions` time (cascade order: `slot → season → game → workspace → default("yes")`).

The field SHALL be parsed by `parseTriviaGames` with the following rules:

- Absence is valid — the cascade resolution falls through to workspace config and ultimately to the `"yes"` default.
- Values other than the three string literals (`"no"`, `"just-correctness"`, `"yes"`) SHALL be rejected with a logged warning naming the game and the violating value, and the entry's `revealResponses` SHALL be treated as absent.
- The value SHALL be exposed on the `TriviaGame` shape returned by `parseTriviaGames` so that the cascade resolver can read it.

#### Scenario: Absent field cascades to workspace config

- **GIVEN** `config.trivia.games[]` has `{ name: "main", ... }` (no `revealResponses` field)
- **AND** `config.trivia.revealResponses: "just-correctness"`
- **WHEN** `post_questions` resolves the cascade for a question in this game (no season / slot override)
- **THEN** the stamped value is `"just-correctness"` (workspace carries through)

#### Scenario: Game-level value beats workspace default

- **GIVEN** `config.trivia.games[]` has `{ name: "main", revealResponses: "no", ... }`
- **AND** `config.trivia.revealResponses: "yes"`
- **AND** no season / slot override
- **WHEN** `post_questions` resolves the cascade for a question in `main`
- **THEN** the stamped value is `"no"`

#### Scenario: Invalid string value is rejected

- **GIVEN** `config.trivia.games[]` has `{ name: "main", revealResponses: "maybe", ... }`
- **WHEN** `parseTriviaGames` runs
- **THEN** a warning is logged identifying the game name and the invalid value
- **AND** the parsed game has no `revealResponses` field (treated as absent)

#### Scenario: Non-string value is rejected

- **GIVEN** `config.trivia.games[]` has `{ name: "main", revealResponses: true, ... }`
- **WHEN** `parseTriviaGames` runs
- **THEN** a warning is logged
- **AND** the parsed game has no `revealResponses` field

#### Scenario: list_games surfaces revealResponses when set

- **GIVEN** a game with `revealResponses: "no"`
- **WHEN** `list_games` runs
- **THEN** the per-game entry in its response includes `revealResponses: "no"`

#### Scenario: list_games omits revealResponses when absent

- **GIVEN** a game without an explicit `revealResponses` value
- **WHEN** `list_games` runs
- **THEN** the per-game entry does NOT include a `revealResponses` field (no default-injection at read time)
