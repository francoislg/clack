## MODIFIED Requirements

### Requirement: Find previous questions tool

The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by category and/or statement text within a specified game.

The tool SHALL accept a required `game: string` argument. The name SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability:
- Unknown name → structured "unknown game" error.
- `enabled: false` entry → success (read tools succeed against disabled games — frozen-archive semantics).

All search I/O SHALL be scoped to `data/plugins/trivia/games/<name>/questions.json`. Cross-game search is not supported.

The tool SHALL accept an optional `season` parameter (string, optional):

- When `season` is omitted, the default SHALL be `"all"` — the tool searches across every entry in the game's `questions.json` regardless of any `season` tag.
- When `season` is `"current"`, the tool SHALL filter the game's `questions.json` to entries whose `season` matches the game's currently-active season's slug (resolved via `findCurrentSeason` against `data/plugins/trivia/games/<name>/seasons.json`). If `findCurrentSeason` returns `null` (gap), `"current"` resolves to no matches.
- When `season` is any other string, the tool SHALL filter to entries whose `season` exactly matches the provided value.

When `trivia.seasons.enabled` is `false`, the `season` parameter SHALL be silently ignored and the tool SHALL search across the entire game's `questions.json`.

#### Scenario: Search by category within a game

- **WHEN** `find_previous_questions` is called with `game: "main", category: "Marine Biology"`
- **THEN** the tool returns all questions in `games/main/questions.json` whose `category` matches "Marine Biology"

#### Scenario: Search by text within a game

- **WHEN** `find_previous_questions` is called with `game: "main", text: "shrimp"`
- **THEN** the tool returns all questions in `games/main/questions.json` whose `statement` contains "shrimp" (case-insensitive)

#### Scenario: Search by both category and text

- **WHEN** `find_previous_questions` is called with `game: "main", category: "Marine Biology", text: "hearts"`
- **THEN** the tool returns questions in `games/main/questions.json` matching both criteria (AND)

#### Scenario: No search criteria provided

- **WHEN** `find_previous_questions` is called with `game: "main"` and neither `category` nor `text`
- **THEN** the tool returns an error indicating at least one search parameter (besides `game`) is required

#### Scenario: Game scoping prevents cross-game matches

- **GIVEN** a question with text "Mount Everest is..." exists in `games/main/questions.json`
- **AND** no such question exists in `games/sandbox/questions.json`
- **WHEN** `find_previous_questions` is called with `game: "sandbox", text: "Everest"`
- **THEN** the result is empty

#### Scenario: Unknown game rejected

- **WHEN** `find_previous_questions` is called with `game: "ghost"` (not in `config.trivia.games[]`)
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game allows search (frozen archive)

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `find_previous_questions` is called with `game: "retired", text: "..."`
- **THEN** the tool succeeds and returns matching historical entries

#### Scenario: Default season is "all" — duplicate detection spans seasons within the game

- **GIVEN** `trivia.seasons.enabled` is `true` with seasons `"spring-2026"` (history) and `"summer-2026"` (current) in `games/main/seasons.json`
- **AND** a question tagged `season: "spring-2026"` exists in `games/main/questions.json`
- **WHEN** `find_previous_questions` is called with `game: "main", text: "..."` and no `season` argument
- **THEN** the spring-2026 question is included in the result set

#### Scenario: Explicit season filter scopes the search

- **WHEN** `find_previous_questions` is called with `game: "main", text: "...", season: "summer-2026"`
- **THEN** only entries tagged `"summer-2026"` are eligible for matching

#### Scenario: "current" during a gap returns empty

- **GIVEN** `findCurrentSeason(games/main/seasons.json, now)` returns `null`
- **WHEN** `find_previous_questions` is called with `game: "main", season: "current"`
- **THEN** the result is empty

### Requirement: save_question replaces generate_question

The system SHALL provide a `save_question` MCP tool (member role) that saves a new trivia question to a specified game.

The tool SHALL accept a required `game: string` argument. The name SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability:
- Unknown name → structured "unknown game" error.
- `enabled: false` entry → structured "game is disabled" error (write tool).

The new question SHALL be appended to `data/plugins/trivia/games/<name>/questions.json` — never to a flat-file `questions.json` at the trivia root, and never to another game's file.

The tool SHALL accept the same content fields as before: `category`, `statement`, `isTrue`, and `emojis`.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<name>/seasons.json, now)` returns a season, each new entry written to the game's `questions.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (gap) for the game's timeline, no `season` field is written.

Category validation reads from the game's currently-active season's `categories` when seasons are enabled with a current season; otherwise from the global `categories.json` at the trivia root.

#### Scenario: Save a valid question to a game

- **WHEN** `save_question` is called with `game: "main"` and a valid category, statement, isTrue, and emojis
- **THEN** the question is appended to `data/plugins/trivia/games/main/questions.json` with a generated ID and `createdAt` timestamp

#### Scenario: Statement too short

- **WHEN** `save_question` is called with `game: "main"` and a statement shorter than 10 characters
- **THEN** the tool returns a validation error

#### Scenario: Statement too long

- **WHEN** `save_question` is called with `game: "main"` and a statement longer than 500 characters
- **THEN** the tool returns a validation error

#### Scenario: Unknown game rejected

- **WHEN** `save_question` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error
- **AND** no file is created or modified

#### Scenario: Disabled game refuses the write

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `save_question` is called with `game: "retired"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error
- **AND** `data/plugins/trivia/games/retired/questions.json` is unchanged

#### Scenario: New question carries the current season tag

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has a current entry with slug `"august-2026"`
- **WHEN** `save_question` is called with `game: "main"` and valid arguments
- **THEN** the new entry in `games/main/questions.json` includes `season: "august-2026"`

#### Scenario: New question carries no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `save_question` is called with `game: "main"` and valid arguments
- **THEN** the new entry in `games/main/questions.json` contains no `season` field

### Requirement: Find previous questions response excludes the answer key

The `find_previous_questions` MCP tool SHALL NOT include the question's `isTrue` field in any element of its returned `questions` array, regardless of caller role. The tool SHALL return only search-safe metadata: `id`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt` and `messageLink`. This requirement is unaffected by the `game` argument — the answer-key exclusion applies to every game's results.

#### Scenario: Response payload omits isTrue

- **WHEN** `find_previous_questions` is invoked with any valid `game` and matches at least one stored question
- **THEN** every element of the returned `questions` array is an object containing `id`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt` and `messageLink`
- **AND** no element contains an `isTrue` field

#### Scenario: Empty result is unaffected

- **WHEN** `find_previous_questions` is invoked with criteria that match no questions in the named game
- **THEN** the tool returns an empty `questions` array
- **AND** no answer-key data is returned in any other field of the response

### Requirement: Get question history tool

The Trivia plugin SHALL expose a `get_question_history` MCP tool that returns the answer key, the list of users caught cheating on the question, and the list of submitted answers, for a single question identified by `questionId` within a specified game.

The tool SHALL be gated to the `admin` role. The tool SHALL accept:

- `game` (string, required) — validated against `config.trivia.games[]`. Read tool — succeeds against `enabled: false` games.
- `questionId` (string, required) — the ID of the trivia question to look up within the named game.

The tool SHALL look up the question in `data/plugins/trivia/games/<game>/questions.json`, the cheat list in `data/plugins/trivia/games/<game>/cheats.json`, and the answers in `data/plugins/trivia/games/<game>/answers.json`. The `displayName` SHALL be looked up from the global `data/plugins/trivia/users.json`.

The tool SHALL return `isTrue` (the answer key), `cheaterUserIds` (deduplicated cheater list from the named game's cheats), and `responses` (every answer entry from the named game with `userId`, `displayName`, `answer`, `correct`).

The tool's description SHALL instruct Claude that cheater identities are internal — Claude MUST NOT name caught cheaters in any user-facing output unless an admin explicitly asks for the list.

#### Scenario: Returns answer key, cheaters, and responses scoped to the game

- **GIVEN** a question `q42` exists in `games/main/questions.json` with `isTrue: true`
- **AND** `games/main/cheats.json` contains entries for `q42` from `U777` and `U888`
- **AND** `games/main/answers.json` contains three entries for `q42` from `U1`, `U2`, `U777`
- **WHEN** `get_question_history` is called with `game: "main", questionId: "q42"`
- **THEN** the response contains `isTrue: true`, `cheaterUserIds: ["U777", "U888"]`, and `responses` with three entries
- **AND** no data from other games' files appears in any field of the response

#### Scenario: Question scoped to wrong game returns not-found

- **GIVEN** question `q42` exists in `games/main/questions.json` but not in `games/sandbox/questions.json`
- **WHEN** `get_question_history` is called with `game: "sandbox", questionId: "q42"`
- **THEN** the tool returns a structured "question not found" error

#### Scenario: Empty cheater list when no cheats recorded

- **GIVEN** question `q43` exists in `games/main/questions.json` with no entries in `games/main/cheats.json`
- **WHEN** `get_question_history` is called with `game: "main", questionId: "q43"`
- **THEN** `cheaterUserIds` is an empty array

#### Scenario: Empty responses for a freshly posted question

- **GIVEN** question `q44` was just saved by `save_question(game: "main", ...)` and no `submit_answers` call has yet referenced it
- **WHEN** `get_question_history` is called with `game: "main", questionId: "q44"`
- **THEN** `responses` is an empty array

#### Scenario: displayName falls back to userId when user record missing

- **GIVEN** `games/main/answers.json` contains an entry for `U999` and the global `users.json` has no record for `U999`
- **WHEN** `get_question_history` is called with `game: "main", questionId: <U999's question>`
- **THEN** the corresponding entry in `responses` has `displayName: "U999"`

#### Scenario: Unknown questionId returns an error

- **WHEN** `get_question_history` is called with a `questionId` that does not appear in the named game's `questions.json`
- **THEN** the tool returns a structured error indicating the question was not found

#### Scenario: Unknown game rejected

- **WHEN** `get_question_history` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `get_question_history` is absent from the session's MCP catalog
