## MODIFIED Requirements

### Requirement: list_seasons tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `list_seasons` MCP tool gated to the `admin` role that returns every entry on a specified game's timeline with full details, including each season's explicitly-set axis configuration so admins can audit the cascade without reading the seasons.json file by hand.

The tool's description SHALL explicitly state the updated cascade rule (`slot → season → game → workspace → built-in default`) and point Claude at `list_games` for both the per-game tier (`axisOverrides`) and the workspace tier (`workspaceDefaults`), so the response can be reasoned about without out-of-band knowledge.

The `theme`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, and `format` fields SHALL be present on a season entry IF AND ONLY IF the season's stored record carries an explicit value for that field. Absent fields signal that the season relies on the next tier of the cascade (per-game overrides, then workspace defaults, then built-in fallback). Slot entries inside `format.questions` follow the same rule — each slot-tier field is present only when the slot literally set it.

Entries SHALL be returned in their stored order. The full `categories` array is included for every entry.

#### Scenario: Description references the four-tier cascade

- **WHEN** the `list_seasons` tool description is loaded into a Claude session
- **THEN** the description contains the string `slot → season → game → workspace`

#### Scenario: list_seasons response unchanged for absent axis fields

- **GIVEN** a season entry stored without `answersFormat` or `contexts`
- **WHEN** `list_seasons` is called
- **THEN** the returned entry omits both fields entirely (signaling cascade fall-through to game / workspace / default)

### Requirement: Per-season question format

The Trivia plugin's per-season question format SHALL surface the cascade `slot → season → game → workspace → built-in default` for every cascading axis. A season's `format.questions[i]` slot MAY override `label`, `categories`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, and `difficulty`. Resolution for any axis on any slot SHALL be:

1. `format.questions[i].<axis>` if set (slot tier)
2. Otherwise the season's top-level `<axis>` if set (season tier)
3. Otherwise the per-game `config.trivia.games[<index>].<axis>` if set (NEW game tier)
4. Otherwise the workspace `config.trivia.<axis>` if set (workspace tier)
5. Otherwise the built-in default per axis

Steps 1, 2, 4, 5 SHALL preserve their existing behavior. Step 3 SHALL be a new lookup inserted between season and workspace and SHALL apply to every cascading axis.

#### Scenario: Slot still overrides season

- **GIVEN** the current season has `answersFormat: { "boolean": 1 }` and `format.questions[0].answersFormat = { "choice": 1 }`
- **AND** `config.trivia.games[0].answersFormat = { "boolean": 0, "choice": 1, "freeform": 1 }`
- **WHEN** `get_ideas(game: "main", slot: 0)` is called
- **THEN** the resolved `answersFormat` is the slot's `{ "choice": 1 }` (slot tier wins; per-game tier never consulted because slot/season provided values)

#### Scenario: Season still overrides per-game

- **GIVEN** the current season has `answersFormat: { "boolean": 1 }` and no `format`
- **AND** `config.trivia.games[0].answersFormat = { "choice": 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the resolved `answersFormat` is the season's `{ "boolean": 1 }` (season tier wins over per-game tier)

#### Scenario: Per-game wins over workspace

- **GIVEN** no slot or season override for `answersFormat`
- **AND** `config.trivia.games[0].answersFormat = { "choice": 1 }`
- **AND** `config.trivia.answersFormat = { "boolean": 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** the resolved `answersFormat` is the per-game `{ "choice": 1 }` (game tier wins over workspace tier)

### Requirement: save_question slot binding

The `save_question` tool SHALL bind each saved question record to a specific season slot (when the active season has a `format`) and SHALL validate the question's axes against the resolved slot cascade `slot → season → game → workspace → built-in default`. The validation steps SHALL be:

1. Resolve the active season for the given `game` argument.
2. If the active season has a `format` field, the call MUST carry a `slot.index` in `[0, format.questions.length)`.
3. Resolve the slot's effective `answersFormat` via the cascade `slot.answersFormat ?? season.answersFormat ?? game.answersFormat ?? config.trivia.answersFormat` and reject the call with an "answers format not permitted by slot" error if the question's actual `answersFormat` value is not in the slot's permitted set (weight > 0).
4. Resolve the slot's effective `questionType` via the cascade `slot.questionType ?? season.questionType ?? game.questionType ?? config.trivia.questionType` and reject the call with a "question type not permitted by slot" error if the question's actual `questionType` value is not in the slot's permitted set (weight > 0).
5. Resolve the slot's effective `categories` via the cascade `slot.categories ?? season.categories` and reject the call with a "category not in slot pool" error if the question's `category` is not in that resolved pool. (Categories do NOT cascade per-game — categories are a season-level concept.)
6. Resolve the slot's effective `contexts` via the cascade `slot.contexts ?? season.contexts ?? game.contexts ?? config.trivia.contexts` (may be absent) and reject the call with a "context not in slot lens list" error if a non-empty `context` argument is provided but does not appear in the resolved contexts list.

The per-game tier (game.* lookups) SHALL be inserted between season and workspace for `answersFormat`, `questionType`, and `contexts`. The categories cascade SHALL NOT gain a per-game tier — categories continue to be season-level.

#### Scenario: Per-game answersFormat permits the saved value

- **GIVEN** the active season has no `answersFormat` override AND no `format`
- **AND** `config.trivia.games[0].answersFormat = { "boolean": 0, "choice": 1 }`
- **WHEN** `save_question(game: "main", answersFormat: "choice", ...)` is called with a valid choice question
- **THEN** the call passes the cascade validation
- **AND** the question is appended to the game's `questions.json`

#### Scenario: Per-game answersFormat rejects the saved value

- **GIVEN** the active season has no `answersFormat` override AND no `format`
- **AND** `config.trivia.games[0].answersFormat = { "boolean": 1, "choice": 0 }` (choice disallowed at game tier)
- **WHEN** `save_question(game: "main", answersFormat: "choice", ...)` is called
- **THEN** the call is rejected with an "answers format not permitted by slot" error

#### Scenario: Season override beats per-game even when game forbids

- **GIVEN** the active season has `answersFormat: { "boolean": 1, "choice": 1 }`
- **AND** `config.trivia.games[0].answersFormat = { "choice": 0 }` (choice disallowed at game tier)
- **WHEN** `save_question(game: "main", answersFormat: "choice", ...)` is called
- **THEN** the call passes (season tier wins; per-game tier never consulted)
