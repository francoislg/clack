## MODIFIED Requirements

### Requirement: Games registry lives in config

The Trivia plugin SHALL treat its plugin-owned config file (`data/plugins/trivia/config.json`, top-level field `games[]`) as the authoritative registry of trivia games. Each entry SHALL have the shape:

```
{
  name: string,                         // unique within games[]; matches ^[a-z0-9-]+$; length 1–32
  channel: string,                      // Slack channel ID where this game's scheduled posts live
  questionCron: string,                 // cron expression for the daily question
  revealCron: string,                   // cron expression for the daily reveal
  timezone: string,                     // IANA timezone
  enabled?: boolean,                    // defaults to true; when false, see "Disabled games" below

  // Optional per-game axis overrides (NEW). Each field uses the same shape as the
  // corresponding workspace-tier field on TriviaConfig. Absent → the per-game tier is
  // skipped and the cascade falls through directly from season to workspace.
  answersFormat?: TriviaAnswersFormatWeights,
  questionType?: TriviaQuestionTypeWeights,
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights,
  contexts?: TriviaContextEntry[],
  difficulty?: TriviaDifficultyConfig
}
```

Game lifecycle (create / update / delete / `enabled` toggle) MAY be performed via the `upsert_game` and `delete_game` MCP tools (see `trivia-management-tools` capability) OR by direct config-file editing. Both paths mutate the same source of truth — `data/plugins/trivia/config.json`. The plugin SHALL re-read the file on every plugin load (which happens at every app boot and on config reload) and reconcile cron specs via `sdk.reconcileCronJobs("trivia", ...)`.

The five per-game axis fields SHALL participate in the cascade `slot → season → game → workspace → built-in default` per the `trivia-game-overrides` capability. The non-cascading workspace-only fields (`choices`, `seasons`, `offDays`) SHALL NOT be settable per-game; attempts to do so SHALL be ignored by the parser.

#### Scenario: Plugin loads games from plugin config file

- **GIVEN** `data/plugins/trivia/config.json` contains `games: [{ name: "main", channel: "C123", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "America/New_York" }]`
- **WHEN** the trivia plugin loads
- **THEN** `sdk.reconcileCronJobs("trivia", specs)` is invoked with two cron specs (`main:question`, `main:reveal`) whose prompts reference `game: "main"`

#### Scenario: Empty games list is supported

- **GIVEN** the plugin config file is absent, or `games` is absent/empty
- **WHEN** the trivia plugin loads
- **THEN** `sdk.reconcileCronJobs("trivia", [])` is invoked (empty spec list — clears any prior plugin-managed trivia cron jobs)

#### Scenario: Per-game axis fields parsed alongside scheduling

- **GIVEN** `games[0]` is `{ name: "main", channel: "C1", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "UTC", answersFormat: { "boolean": 1, "choice": 2 } }`
- **WHEN** the trivia plugin loads
- **THEN** the parsed entry carries both the scheduling fields AND `answersFormat: { "boolean": 1, "choice": 2, "freeform": 0 }`
- **AND** axis resolvers consulting the per-game tier observe this value

### Requirement: list_games tool

The Trivia plugin SHALL expose a `list_games` MCP tool gated to the `member` role that returns the list of games from the plugin config AND the workspace tier of the cascading axis configuration so admins can audit every tier without reading `config.json` by hand. The tool SHALL accept one optional argument:

- `includeDisabled` (boolean, optional, default `false`) — when `true`, entries with `enabled: false` are included in the response.

The tool SHALL return:

```
{
  games: Array<{
    name: string,
    channel: string,
    timezone: string,
    enabled: boolean,
    questionCron: string,
    revealCron: string,
    axisOverrides: {
      answersFormat?: TriviaAnswersFormatWeights,
      questionType?: TriviaQuestionTypeWeights,
      freeformAnswerShape?: TriviaFreeformAnswerShapeWeights,
      contexts?: TriviaContextEntry[],
      difficulty?: TriviaDifficultyConfig
    }
  }>,
  workspaceDefaults: {
    answersFormat?: TriviaAnswersFormatWeights,
    questionType?: TriviaQuestionTypeWeights,
    freeformAnswerShape?: TriviaFreeformAnswerShapeWeights,
    contexts?: TriviaContextEntry[],
    difficulty?: TriviaDifficultyConfig,
    choices?: TriviaChoicesConfig,
    seasons?: { enabled: boolean, prompt: string },
    offDays?: OffDay[]
  },
  total: number
}
```

Entries SHALL be returned in their config order. The `questionCron` and `revealCron` fields SHALL be included on every game entry to support configuration audits.

The `axisOverrides` block on each game entry SHALL surface the per-game tier of the cascading axis configuration. Each field SHALL be present in `axisOverrides` IF AND ONLY IF the matching `TriviaGame` entry carries an explicit value for it. The block SHALL be included unconditionally on every entry (possibly as `{}`) so callers can distinguish "this game has no per-game overrides" from "the field was missing from the response".

The `workspaceDefaults` block SHALL surface workspace-tier configuration from the plugin config file. Each field SHALL be present in `workspaceDefaults` IF AND ONLY IF the plugin config carries an explicit value for it. The block is included unconditionally on every response (possibly as `{}`).

The tool's description SHALL explicitly state the updated cascade rule (`slot → season → game → workspace → built-in default`) and point Claude at `list_seasons` for the slot + season tiers AND at the `trivia_management` integration for managing the game/workspace tiers.

#### Scenario: Default response excludes disabled games

- **GIVEN** the plugin config has `main` (enabled) and `retired` (`enabled: false`) games
- **WHEN** `list_games` is called with no arguments
- **THEN** the response contains exactly one entry with `name: "main"`
- **AND** `total` is 1

#### Scenario: includeDisabled returns the full registry

- **GIVEN** the plugin config has `main` (enabled) and `retired` (`enabled: false`)
- **WHEN** `list_games` is called with `includeDisabled: true`
- **THEN** the response contains both entries
- **AND** `total` is 2

#### Scenario: Cron expressions and timezone are surfaced per game

- **GIVEN** a game `main` configured with `questionCron: "0 9 * * MON-FRI"` and `revealCron: "0 17 * * MON-FRI"` in `America/Toronto`
- **WHEN** `list_games` is called
- **THEN** the `main` entry's `questionCron` is `"0 9 * * MON-FRI"`
- **AND** the entry's `revealCron` is `"0 17 * * MON-FRI"`
- **AND** the entry's `timezone` is `"America/Toronto"`

#### Scenario: Per-game axisOverrides surfaces set fields

- **GIVEN** `games[0]` is `{ name: "main", ..., answersFormat: { "boolean": 0, "choice": 1 }, contexts: [{ name: "Quebec" }] }`
- **WHEN** `list_games` is called
- **THEN** the `main` entry's `axisOverrides.answersFormat` matches `{ "boolean": 0, "choice": 1, "freeform": 0 }`
- **AND** the entry's `axisOverrides.contexts` matches `[{ name: "Quebec" }]`
- **AND** `axisOverrides.questionType`, `axisOverrides.freeformAnswerShape`, `axisOverrides.difficulty` are absent

#### Scenario: Empty axisOverrides still present in response

- **GIVEN** `games[0]` has no per-game axis fields set
- **WHEN** `list_games` is called
- **THEN** the `main` entry includes an `axisOverrides` key
- **AND** the entry's `axisOverrides` is `{}` (empty object)

#### Scenario: Workspace defaults surface every set axis

- **GIVEN** the plugin config has `answersFormat: { boolean: 2, choice: 1, freeform: 0 }` and `freeformAnswerShape: { name: 3, ... }` and `seasons: { enabled: true, prompt: "Monthly" }` but no `questionType`, `contexts`, `difficulty`, or `offDays`
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.answersFormat` matches the stored value
- **AND** `workspaceDefaults.freeformAnswerShape` matches the stored value
- **AND** `workspaceDefaults.seasons` matches the stored value
- **AND** `workspaceDefaults.questionType` is absent
- **AND** `workspaceDefaults.contexts` is absent
- **AND** `workspaceDefaults.difficulty` is absent
- **AND** `workspaceDefaults.offDays` is absent

#### Scenario: Empty workspace defaults still present in response

- **GIVEN** the plugin config has no axis configuration set at all (only `games` populated)
- **WHEN** `list_games` is called
- **THEN** the response includes a `workspaceDefaults` key
- **AND** `workspaceDefaults` is `{}` (empty object)

#### Scenario: Empty config returns empty array

- **GIVEN** the plugin config has no `games` (absent or empty)
- **WHEN** `list_games` is called
- **THEN** the response is `{ games: [], workspaceDefaults: {...}, total: 0 }` (workspaceDefaults still reflects workspace tier)

#### Scenario: Tool is gated to member

- **WHEN** a session's user has role `member` or higher
- **THEN** `list_games` appears in the session's MCP catalog
