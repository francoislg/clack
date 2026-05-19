## MODIFIED Requirements

### Requirement: Find previous questions tool

The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by category and/or statement text within a specified game.

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against the games registry per the `trivia-games` capability (unknown slug → structured error). All search I/O SHALL be scoped to `data/plugins/trivia/games/<slug>/questions.json` — cross-game search is not supported.

The tool SHALL accept an optional `season` parameter (string, optional):

- When `season` is omitted, the default SHALL be `"all"` — the tool searches across every entry in the game's `questions.json` regardless of any `season` tag. This default ensures duplicate detection naturally spans the game's seasons.
- When `season` is `"current"`, the tool SHALL filter the game's `questions.json` to entries whose `season` matches the game's currently-active season's slug (resolved via `findCurrentSeason(state, now)` against `data/plugins/trivia/games/<slug>/seasons.json`). If `findCurrentSeason` returns `null` (gap), `"current"` resolves to no matches.
- When `season` is any other string, the tool SHALL filter to entries whose `season` exactly matches the provided value.

When `trivia.seasons.enabled` is `false`, the `season` parameter SHALL be silently ignored and the tool SHALL search across the entire game's `questions.json` (legacy behavior).

The tool SHALL succeed against disabled games (frozen-archive reads).

#### Scenario: Search by category

- **WHEN** `find_previous_questions` is called with `game: "main", category: "Marine Biology"`
- **THEN** the tool returns all questions in the `main` game whose `category` matches "Marine Biology"

#### Scenario: Search by text

- **WHEN** `find_previous_questions` is called with `game: "main", text: "shrimp"`
- **THEN** the tool returns all questions in the `main` game whose `statement` contains "shrimp" (case-insensitive)

#### Scenario: Search by both category and text

- **WHEN** `find_previous_questions` is called with `game: "main", category: "Marine Biology", text: "hearts"`
- **THEN** the tool returns questions in the `main` game matching both criteria (AND)

#### Scenario: No parameters provided

- **WHEN** `find_previous_questions` is called with `game: "main"` and neither `category` nor `text`
- **THEN** the tool returns an error indicating at least one search parameter (besides `game`) is required

#### Scenario: No matches found

- **WHEN** `find_previous_questions` is called with criteria that match no questions in the named game
- **THEN** the tool returns an empty result set

#### Scenario: Game scoping prevents cross-game matches

- **GIVEN** a question with text "Mount Everest is..." exists in `games/main/questions.json`
- **AND** no such question exists in `games/sandbox/questions.json`
- **WHEN** `find_previous_questions` is called with `game: "sandbox", text: "Everest"`
- **THEN** the result is empty
- **AND** the `main` game's question is NOT returned

#### Scenario: Unknown game rejected

- **WHEN** `find_previous_questions` is called with `game: "ghost"` (not in the registry)
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game allows search (frozen archive)

- **GIVEN** `games.json` marks `retired-2025` as `disabled: true`
- **WHEN** `find_previous_questions` is called with `game: "retired-2025", text: "..."`
- **THEN** the tool succeeds and returns matching historical entries

#### Scenario: Default season is "all" — duplicate detection spans seasons within the game

- **GIVEN** `trivia.seasons.enabled` is `true` with seasons `"spring-2026"` (history) and `"summer-2026"` (current) in `games/main/seasons.json`
- **AND** a question with text "Mount Everest is..." exists in `games/main/questions.json` tagged `season: "spring-2026"`
- **WHEN** `find_previous_questions` is called with `game: "main", text: "Everest"` and no `season` argument
- **THEN** the spring-2026 question is included in the result set

#### Scenario: Explicit season filter scopes the search

- **GIVEN** `games/main/questions.json` contains entries tagged `"spring-2026"` and `"summer-2026"`
- **WHEN** `find_previous_questions` is called with `game: "main", text: "...", season: "summer-2026"`
- **THEN** only entries tagged `"summer-2026"` are eligible for matching

#### Scenario: Seasons disabled — season parameter ignored

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `find_previous_questions` is called with `game: "main", season: "anything"`
- **THEN** the search proceeds across the entire `games/main/questions.json` without any season filter

#### Scenario: "current" during a gap returns empty

- **GIVEN** `trivia.seasons.enabled` is `true` but `findCurrentSeason(games/main/seasons.json, now)` returns `null` (timeline gap)
- **WHEN** `find_previous_questions` is called with `game: "main", season: "current"`
- **THEN** the result is empty (no current season exists to match against)

### Requirement: save_question replaces generate_question

The system SHALL provide a `save_question` MCP tool (member role) that saves a new trivia question to a specified game.

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against the games registry per the `trivia-games` capability (unknown slug → structured error; disabled slug → structured "game is disabled" error). The new question SHALL be appended to `data/plugins/trivia/games/<slug>/questions.json` — never to a flat-file `questions.json` at the trivia root, and never to another game's file.

The tool SHALL accept the same content fields as before: `category`, `statement`, `isTrue`, and `emojis`.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<slug>/seasons.json, now)` returns a season, each new entry written to the game's `questions.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (gap) for the game's timeline, no `season` field is written.

Category validation reads from the game's currently-active season's `categories` when seasons are enabled with a current season in that game; otherwise from the global `categories.json` at the trivia root.

#### Scenario: Save a valid question to a game

- **WHEN** `save_question` is called with `game: "main"` and a valid category, statement, isTrue, and emojis
- **THEN** the question is appended to `data/plugins/trivia/games/main/questions.json` with a generated ID and `createdAt` timestamp
- **AND** no other game's `questions.json` is touched

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

- **GIVEN** `games.json` marks `retired-2025` as `disabled: true`
- **WHEN** `save_question` is called with `game: "retired-2025"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error
- **AND** `data/plugins/trivia/games/retired-2025/questions.json` is unchanged

#### Scenario: New question carries the current season tag when seasons are enabled for that game

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has a current entry with slug `"august-2026"`
- **WHEN** `save_question` is called with `game: "main"` and valid arguments
- **THEN** the new entry in `games/main/questions.json` includes `season: "august-2026"`

#### Scenario: New question carries no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `save_question` is called with `game: "main"` and valid arguments
- **THEN** the new entry in `games/main/questions.json` contains no `season` field

### Requirement: Find previous questions response excludes the answer key

The `find_previous_questions` MCP tool SHALL NOT include the question's `isTrue` field in any element of its returned `questions` array, regardless of caller role. The tool SHALL return only search-safe metadata: `id`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt` and `messageLink`.

This requirement closes a pre-existing exposure where any session at the `member` tier could prompt Clack into surfacing the canonical answer key for past questions through the search tool. The tool's gating remains `member`; the response shape is what changes. This requirement is unaffected by the `game` argument — the answer-key exclusion applies to every game's results.

#### Scenario: Response payload omits isTrue

- **WHEN** `find_previous_questions` is invoked with any combination of valid arguments (including `game`) and matches at least one stored question
- **THEN** every element of the returned `questions` array is an object containing `id`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt` and `messageLink`
- **AND** no element contains an `isTrue` field

#### Scenario: Empty result is unaffected

- **WHEN** `find_previous_questions` is invoked with criteria that match no questions in the named game
- **THEN** the tool returns an empty `questions` array
- **AND** no answer-key data is returned in any other field of the response

### Requirement: Get question history tool

The Trivia plugin SHALL expose a `get_question_history` MCP tool that returns the answer key, the list of users caught cheating on the question, and the list of submitted answers, for a single question identified by `questionId` within a specified game.

The tool SHALL be gated to the `admin` role. The tool SHALL accept the following arguments:

- `game` (string, required) — the game slug; validated against the games registry per the `trivia-games` capability. The tool succeeds against disabled games (frozen-archive read).
- `questionId` (string, required) — the ID of the trivia question to look up within the named game.

The tool SHALL look up the question only in `data/plugins/trivia/games/<game>/questions.json`, the cheat list only in `data/plugins/trivia/games/<game>/cheats.json`, and the answers only in `data/plugins/trivia/games/<game>/answers.json`. The `displayName` SHALL be looked up from the global `data/plugins/trivia/users.json`.

The tool SHALL return:

- `isTrue` (boolean) — the canonical answer key for the question as recorded by `save_question`.
- `cheaterUserIds` (string array) — the deduplicated list of `cheaterUserId` values from every entry in the named game's `cheats.json` whose `questionId` matches the requested question.
- `responses` (array of objects) — every entry from the named game's `answers.json` whose `questionId` matches, projected to `{ userId, displayName, answer, correct }`. When no user record exists in the global `users.json`, `displayName` SHALL fall back to `userId`.

The tool's description SHALL instruct Claude that cheater identities are internal — Claude MUST NOT name caught cheaters in any user-facing output unless an admin explicitly asks for the list.

#### Scenario: Returns answer key, cheaters, and responses scoped to the game

- **GIVEN** a question `q42` exists in `games/main/questions.json` with `isTrue: true`
- **AND** `games/main/cheats.json` contains two entries with `questionId: "q42"` and `cheaterUserId` values `"U777"` and `"U888"`, plus one entry with a different `questionId`
- **AND** `games/main/answers.json` contains three entries with `questionId: "q42"` for users `U1`, `U2`, `U777`
- **AND** `users.json` (global) contains records for `U1`, `U2`, and `U777` with `displayName` fields
- **WHEN** `get_question_history` is called with `game: "main", questionId: "q42"`
- **THEN** the response contains `isTrue: true`
- **AND** `cheaterUserIds` is the deduplicated set `["U777", "U888"]` (order is not significant)
- **AND** `responses` contains exactly three entries, one per `q42` answer, each with the matching `userId`, the `displayName` from the global `users.json`, and the recorded `answer` and `correct`
- **AND** no entries from other games' files appear in any field of the response

#### Scenario: Question scoped to wrong game returns not-found

- **GIVEN** question `q42` exists in `games/main/questions.json` but not in `games/sandbox/questions.json`
- **WHEN** `get_question_history` is called with `game: "sandbox", questionId: "q42"`
- **THEN** the tool returns a structured "question not found" error
- **AND** no data from the `main` game leaks into the response

#### Scenario: Empty cheater list when no cheats recorded for that game's question

- **GIVEN** question `q43` exists in `games/main/questions.json` with no entries in `games/main/cheats.json`
- **WHEN** `get_question_history` is called with `game: "main", questionId: "q43"`
- **THEN** `cheaterUserIds` is an empty array
- **AND** `responses` reflects whatever answers exist for `q43` in `games/main/answers.json` (possibly empty)

#### Scenario: Empty responses for a freshly posted question

- **GIVEN** question `q44` was just saved by `save_question(game: "main", ...)` and no `submit_answers` call has yet referenced it
- **WHEN** `get_question_history` is called with `game: "main", questionId: "q44"`
- **THEN** `responses` is an empty array
- **AND** `cheaterUserIds` reflects any cheats already recorded for `q44` in `games/main/cheats.json` (possibly empty)

#### Scenario: displayName falls back to userId when user record missing

- **GIVEN** `games/main/answers.json` contains an entry with `userId: "U999"` for question `q45`
- **AND** `users.json` (global) has no record for `U999`
- **WHEN** `get_question_history` is called with `game: "main", questionId: "q45"`
- **THEN** the corresponding entry in `responses` has `displayName: "U999"`

#### Scenario: Unknown questionId returns an error

- **WHEN** `get_question_history` is called with a `questionId` that does not appear in the named game's `questions.json`
- **THEN** the tool returns a structured error indicating the question was not found
- **AND** the response contains no `isTrue`, `cheaterUserIds`, or `responses` fields

#### Scenario: Unknown game rejected

- **WHEN** `get_question_history` is called with `game: "ghost"` (not in the registry)
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `get_question_history` is absent from the session's MCP catalog
