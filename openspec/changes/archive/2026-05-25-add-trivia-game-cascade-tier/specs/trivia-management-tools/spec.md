## ADDED Requirements

### Requirement: trivia_management integration

The system SHALL register `trivia_management` as a non-always-load entry in `config.mcpServers` (in `data/config.json`). The entry SHALL declare `alwaysLoad: false` and a `description` summarizing its purpose ("Manage trivia games (add/remove/configure) and workspace-tier defaults. Admin only.").

The integration's catalog entry SHALL make `attach_integration("trivia_management")` valid per the existing lazy-mcp-loading mechanism. When attached, the existing topic-instruction flow SHALL surface a `trivia-management` instruction file in the assembled prompt for that session.

#### Scenario: Integration catalog includes trivia_management

- **WHEN** the system loads its config
- **THEN** `config.mcpServers.trivia_management` is present
- **AND** the entry has `alwaysLoad: false`
- **AND** the entry has a non-empty `description`

#### Scenario: attach_integration accepts trivia_management

- **GIVEN** an admin session
- **WHEN** Claude calls `attach_integration({ name: "trivia_management" })`
- **THEN** the call succeeds
- **AND** the response includes the trivia-management topic instructions

### Requirement: upsert_game tool

The trivia plugin SHALL expose an `upsert_game` MCP tool gated to the `admin` role. The tool SHALL accept:

- `name: string` (required) — the game's identifier, must match `^[a-z0-9-]+$` and be 1-32 chars
- `channel?: string` — Slack channel ID (required on CREATE)
- `questionCron?: string` — cron expression (required on CREATE)
- `revealCron?: string` — cron expression (required on CREATE)
- `timezone?: string` — IANA timezone (required on CREATE)
- `enabled?: boolean` — defaults to `true` on CREATE; toggleable on UPDATE
- `answersFormat?: TriviaAnswersFormatWeights | null`
- `questionType?: TriviaQuestionTypeWeights | null`
- `freeformAnswerShape?: TriviaFreeformAnswerShapeWeights | null`
- `contexts?: TriviaContextEntry[] | null`
- `difficulty?: TriviaDifficultyConfig | null`

The tool SHALL detect CREATE vs UPDATE by checking whether `name` already exists in the registry:

**On CREATE** (name not found):
- `channel`, `questionCron`, `revealCron`, `timezone` MUST all be provided. Missing any → "creating a new game requires …" error.
- Cron expressions are validated against the provided `timezone` using `CronExpressionParser.parse` (same as the file-load parser).
- `enabled` defaults to `true` if omitted.
- Axis fields are stored verbatim when provided.

**On UPDATE** (name found):
- Scheduling fields use omit-to-keep semantics; provided values replace the prior value.
- `enabled` may be toggled to `false` (disabling) or back to `true`.
- Axis fields use omit-to-keep semantics; explicit `null` clears the field on the target entry.

Validation SHALL use the existing parsers/validators (`validateAnswersFormatMap`, `validateQuestionTypeMap`, `validateFreeformAnswerShapeMap`, `validateContextsList`, `validateTriviaDifficultyMap`). Validation failures SHALL return an `errorResult` with the validator's message.

On success the tool SHALL write the updated `TriviaConfig` to `data/plugins/trivia/config.json` via `saveTriviaConfig`, refresh the in-memory cache, and return `{ name, action: "created" | "updated", enabled, hasAxisOverrides: boolean }`.

#### Scenario: Create a new game

- **GIVEN** `config.games[]` has no entry named `engineering`
- **WHEN** `upsert_game(name: "engineering", channel: "C123", questionCron: "0 9 * * 1-5", revealCron: "0 17 * * 1-5", timezone: "America/Montreal")` is called
- **THEN** `data/plugins/trivia/config.json` `games[]` gains the entry
- **AND** the response is `{ name: "engineering", action: "created", enabled: true, hasAxisOverrides: false }`

#### Scenario: Create with axis overrides

- **WHEN** `upsert_game(name: "engineering", channel: "C123", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "UTC", answersFormat: { boolean: 0, choice: 1 })` is called against a fresh registry
- **THEN** the new entry carries `answersFormat: { boolean: 0, choice: 1, freeform: 0 }`
- **AND** the response's `hasAxisOverrides` is `true`

#### Scenario: Create without required scheduling fields rejected

- **WHEN** `upsert_game(name: "engineering", channel: "C123")` is called against a fresh registry (missing questionCron / revealCron / timezone)
- **THEN** the tool returns an error identifying the missing fields

#### Scenario: Update existing game's schedule

- **GIVEN** `config.games[0]` is `{ name: "main", channel: "C1", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "UTC" }`
- **WHEN** `upsert_game(name: "main", questionCron: "0 10 * * *")` is called
- **THEN** the entry's `questionCron` is updated to `"0 10 * * *"`
- **AND** the other scheduling fields are preserved
- **AND** the response's `action` is `"updated"`

#### Scenario: Update axis field to a new value

- **GIVEN** `config.games[0]` is `{ name: "main", ... }` with no `answersFormat`
- **WHEN** `upsert_game(name: "main", answersFormat: { boolean: 1, choice: 1 })` is called
- **THEN** the entry's `answersFormat` is set to `{ boolean: 1, choice: 1, freeform: 0 }`

#### Scenario: Clear axis field with null

- **GIVEN** `config.games[0]` has `answersFormat: { boolean: 1 }`
- **WHEN** `upsert_game(name: "main", answersFormat: null)` is called
- **THEN** the entry's `answersFormat` is removed
- **AND** the cascade falls through to workspace/default on next resolve

#### Scenario: Invalid axis value rejected

- **WHEN** `upsert_game(name: "main", answersFormat: { boolean: 0, choice: 0 })` is called (all-zero, invalid)
- **THEN** the tool returns an "invalid answersFormat" error
- **AND** the file is not modified

#### Scenario: Invalid cron expression rejected on create

- **WHEN** `upsert_game(name: "newgame", channel: "C1", questionCron: "not a cron", revealCron: "0 17 * * *", timezone: "UTC")` is called
- **THEN** the tool returns an error identifying the invalid cron
- **AND** the file is not modified

#### Scenario: Tool gated to admin

- **WHEN** a session's user has role `admin` or higher
- **THEN** `upsert_game` appears in the session's MCP catalog
- **WHEN** a session's user has role `dev` or lower
- **THEN** `upsert_game` does NOT appear in the session's MCP catalog

### Requirement: delete_game tool

The trivia plugin SHALL expose a `delete_game` MCP tool gated to the `admin` role. The tool SHALL accept:

- `name: string` (required) — the game's identifier

The tool SHALL:
1. Reject calls naming an unknown game with a structured "unknown game" error.
2. Remove the entry from `data/plugins/trivia/config.json` `games[]`.
3. Save via `saveTriviaConfig`; the plugin reconciles cron jobs on next load.
4. NOT touch the data directory at `data/plugins/trivia/games/<name>/` — that directory remains for archival until an operator deletes it manually.
5. Return `{ name, action: "deleted" }`.

The tool's description SHALL warn admins that deletion removes the game's cron jobs immediately on next reconcile and that the game's data directory is preserved.

#### Scenario: Delete a registered game

- **GIVEN** `config.games[]` contains an entry named `retired`
- **WHEN** `delete_game(name: "retired")` is called
- **THEN** the entry is removed from `data/plugins/trivia/config.json`
- **AND** the response is `{ name: "retired", action: "deleted" }`

#### Scenario: Data directory preserved after delete

- **GIVEN** `data/plugins/trivia/games/retired/questions.json` exists
- **WHEN** `delete_game(name: "retired")` is called
- **THEN** `data/plugins/trivia/games/retired/` and its contents remain on disk

#### Scenario: Unknown game rejected

- **GIVEN** `config.games[]` has no entry named `ghost`
- **WHEN** `delete_game(name: "ghost")` is called
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool gated to admin

- **WHEN** a session's user has role `admin` or higher
- **THEN** `delete_game` appears in the session's MCP catalog

### Requirement: set_workspace_config tool

The trivia plugin SHALL expose a `set_workspace_config` MCP tool gated to the `admin` role. The tool SHALL accept any subset of:

- `answersFormat?: TriviaAnswersFormatWeights | null`
- `questionType?: TriviaQuestionTypeWeights | null`
- `freeformAnswerShape?: TriviaFreeformAnswerShapeWeights | null`
- `contexts?: TriviaContextEntry[] | null`
- `difficulty?: TriviaDifficultyConfig | null`
- `choices?: { min: number; max: number } | null`
- `offDays?: OffDay[] | null`
- `seasons?: { enabled: boolean; prompt: string } | null`

The tool SHALL:
1. Reject calls with no fields with a "no fields to update" error.
2. Validate each provided field with the same parser/validator used at file-load time (`validateAnswersFormatMap`, etc.).
3. Apply omit-to-keep semantics — omitted fields stay at their current value.
4. Apply explicit `null` to clear the field from the workspace tier.
5. Save the updated `TriviaConfig` via `saveTriviaConfig`.
6. Return `{ action: "updated", updatedFields: string[] }`.

#### Scenario: Set workspace answersFormat

- **GIVEN** `config.answersFormat` is absent
- **WHEN** `set_workspace_config(answersFormat: { boolean: 2, choice: 1 })` is called
- **THEN** the file's top-level `answersFormat` is set to `{ boolean: 2, choice: 1, freeform: 0 }`
- **AND** the response's `updatedFields` includes `"answersFormat"`

#### Scenario: Clear workspace contexts with null

- **GIVEN** `config.contexts` is `[{ name: "Quebec" }]`
- **WHEN** `set_workspace_config(contexts: null)` is called
- **THEN** the `contexts` field is removed from the file
- **AND** `axis resolvers` fall through to built-in default for contexts

#### Scenario: Update multiple fields atomically

- **WHEN** `set_workspace_config(answersFormat: { boolean: 1, choice: 1 }, choices: { min: 3, max: 4 })` is called
- **THEN** both fields are written in one save
- **AND** the response's `updatedFields` lists both

#### Scenario: Empty update rejected

- **WHEN** `set_workspace_config()` is called with no fields
- **THEN** the tool returns a "no fields to update" error

#### Scenario: Invalid choices rejected

- **WHEN** `set_workspace_config(choices: { min: 5, max: 4 })` is called
- **THEN** the tool returns the validator's error about min ≤ max
- **AND** the file is not modified

#### Scenario: Toggle seasons feature on

- **GIVEN** `config.seasons` is absent
- **WHEN** `set_workspace_config(seasons: { enabled: true, prompt: "Monthly themed seasons" })` is called
- **THEN** the file's `seasons` field is set with `enabled: true`

#### Scenario: Tool gated to admin

- **WHEN** a session's user has role `admin` or higher
- **THEN** `set_workspace_config` appears in the session's MCP catalog

### Requirement: trivia-management topic instructions

The trivia plugin SHALL register a `trivia-management` topic instruction under the admin role via `sdk.addInstruction("admin", "trivia-management", TRIVIA_MANAGEMENT_INSTRUCTION)`. The instruction SHALL document:

1. The `trivia_management` integration name and what triggers it (admin asks to add/remove a game or change workspace-level trivia config).
2. The three tools' signatures (`upsert_game`, `delete_game`, `set_workspace_config`) with their argument shapes.
3. The cascade rule (`slot → season → game → workspace → built-in default`) and where each field can be configured.
4. The reminder that per-game axis overrides go in `upsert_game`'s axis arguments; workspace-tier overrides go in `set_workspace_config`.

The instruction SHALL be at most ~120 lines (it's part of the always-loaded admin baseline until the parallel `add-plugin-topic-instructions` change enables lazy loading).

#### Scenario: Admin session catalog includes the management instruction

- **GIVEN** an admin session
- **WHEN** the instruction set is assembled
- **THEN** the assembled prompt contains the `TRIVIA_MANAGEMENT_INSTRUCTION` content
- **AND** the content references `upsert_game`, `delete_game`, `set_workspace_config` by name
- **AND** the content contains the cascade string `slot → season → game → workspace`
