## ADDED Requirements

### Requirement: Trivia configuration lives in a plugin-owned file

The trivia plugin SHALL store its full `TriviaConfig` (games, seasons, axes, choices, offDays) at `data/plugins/trivia/config.json`. The file's top-level JSON value SHALL be the `TriviaConfig` object directly (no `trivia` wrapper key). The main bot config file (`data/config.json`) SHALL NOT carry a `trivia` field after the boot migration runs.

The plugin SHALL load this file at plugin init using the existing `parseTrivia*` family of functions (`parseTriviaGames`, `parseTriviaAnswersFormat`, `parseTriviaQuestionType`, `parseTriviaFreeformAnswerShape`, `parseTriviaContexts`, `parseTriviaDifficulty`, `parseTriviaChoicesConfig`, `parseOffDays`). When the file is absent OR is an empty object `{}`, the plugin SHALL behave as if no trivia configuration is set (no games registered, all cascade tiers fall through to built-in defaults). When the file is malformed JSON, plugin init SHALL fail with a clear error pointing at the file path.

#### Scenario: Plugin loads config from the new file

- **GIVEN** `data/plugins/trivia/config.json` contains a valid `TriviaConfig` object with one game
- **WHEN** the trivia plugin loads
- **THEN** `getTriviaConfig()` returns the parsed config
- **AND** `getTriviaGames()` returns the game registry
- **AND** the plugin reconciles cron jobs for the registered game

#### Scenario: Absent plugin config file is treated as empty

- **GIVEN** `data/plugins/trivia/config.json` does not exist
- **WHEN** the trivia plugin loads
- **THEN** the plugin loads with no games registered
- **AND** all axis resolvers fall through to built-in defaults
- **AND** no warnings or errors are logged for the missing file

#### Scenario: Malformed JSON in plugin config file is a hard error

- **GIVEN** `data/plugins/trivia/config.json` contains invalid JSON
- **WHEN** the trivia plugin loads
- **THEN** plugin init fails with an error identifying the file path and the parse failure

### Requirement: Plugin config accessors replace `getConfig().trivia`

The trivia plugin SHALL expose its loaded config via `getTriviaConfig(): TriviaConfig | null` and `getTriviaGames(): readonly TriviaGame[]` from `src/plugins/trivia/core/configBridge.ts`. Every internal caller that previously read `getConfig().trivia.*` SHALL migrate to one of these accessors.

The `Config` type in `src/config.ts` SHALL NOT carry a `trivia` field. Workspace-tier `parseTrivia*` functions MAY remain exported from `src/config.ts` (the plugin loader calls them) but their parser invocation SHALL no longer happen inside `loadConfig()`.

#### Scenario: Resolvers receive workspace tier from plugin accessor

- **GIVEN** `data/plugins/trivia/config.json` has `answersFormat: { boolean: 1 }`
- **AND** the trivia plugin has loaded
- **WHEN** `get_ideas` is invoked
- **THEN** the workspace-tier portion of the cascade reads from `getTriviaConfig()`, NOT from `getConfig().trivia`

#### Scenario: Config type has no trivia field

- **WHEN** the TypeScript build runs
- **THEN** the `Config` interface in `src/config.ts` has no `trivia` property
- **AND** any source file that references `Config['trivia']` fails to compile

### Requirement: Plugin saves config writes via a dedicated saver

Mutations to `data/plugins/trivia/config.json` (made by the new management MCP tools) SHALL go through a single `saveTriviaConfig(next: TriviaConfig)` function in `src/plugins/trivia/core/configBridge.ts`. The saver SHALL:

1. Serialize the `TriviaConfig` with `JSON.stringify(value, null, 2)` (pretty-printed, two-space indent — matches the project's other JSON files).
2. Write atomically (write-temp-then-rename pattern matching `src/plugins/trivia/core/dataLayer.ts`).
3. After a successful write, refresh the in-memory cache so subsequent `getTriviaConfig()` calls see the new value within the same process.

#### Scenario: Tool writes propagate to subsequent reads

- **GIVEN** the trivia plugin has loaded with config A
- **WHEN** a management tool successfully calls `saveTriviaConfig(B)`
- **THEN** the next `getTriviaConfig()` call returns config B without requiring a process restart

#### Scenario: Atomic write prevents torn files

- **GIVEN** a `saveTriviaConfig` call is in progress
- **WHEN** the write is interrupted (process crash, disk full)
- **THEN** `data/plugins/trivia/config.json` either contains the prior valid content OR the new valid content — never a partial / corrupt mix
