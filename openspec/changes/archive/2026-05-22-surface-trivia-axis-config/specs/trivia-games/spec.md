## MODIFIED Requirements

### Requirement: list_games tool

The Trivia plugin SHALL expose a `list_games` MCP tool gated to the `member` role that returns the list of games from `config.trivia.games[]` AND the workspace tier of the cascading axis configuration so admins can audit every tier without reading `config.json` by hand. The tool SHALL accept one optional argument:

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
    revealCron: string
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

Entries SHALL be returned in their config order. The previously-excluded `questionCron` and `revealCron` fields SHALL now be included on every game entry to support configuration audits.

The `workspaceDefaults` block SHALL surface workspace-tier configuration from `config.trivia.*`. Each field SHALL be present in `workspaceDefaults` IF AND ONLY IF `config.trivia` carries an explicit value for it (e.g. `freeformAnswerShape` appears only when `config.trivia.freeformAnswerShape` is set in the loaded config). Absent fields signal that the workspace relies on the built-in cascade default. The block is included unconditionally on every response (possibly as `{}`) so callers can distinguish "workspace had no overrides" from "we forgot to ask".

The tool's description SHALL explicitly state the cascade rule (slot → season → workspace → built-in default) and point Claude at `list_seasons` for the slot + season tiers, so the response can be reasoned about without out-of-band knowledge.

#### Scenario: Default response excludes disabled games

- **GIVEN** `config.trivia.games[]` contains `main` (enabled) and `retired` (`enabled: false`)
- **WHEN** `list_games` is called with no arguments
- **THEN** the response contains exactly one entry with `name: "main"`
- **AND** `total` is 1

#### Scenario: includeDisabled returns the full registry

- **GIVEN** `config.trivia.games[]` contains `main` (enabled) and `retired` (`enabled: false`)
- **WHEN** `list_games` is called with `includeDisabled: true`
- **THEN** the response contains both entries
- **AND** `total` is 2

#### Scenario: Cron expressions and timezone are surfaced per game

- **GIVEN** a game `main` configured with `questionCron: "0 9 * * MON-FRI"` and `revealCron: "0 17 * * MON-FRI"` in `America/Toronto`
- **WHEN** `list_games` is called
- **THEN** the `main` entry's `questionCron` is `"0 9 * * MON-FRI"`
- **AND** the entry's `revealCron` is `"0 17 * * MON-FRI"`
- **AND** the entry's `timezone` is `"America/Toronto"`

#### Scenario: Workspace defaults surface every set axis

- **GIVEN** `config.trivia` has `answersFormat: { boolean: 2, choice: 1, freeform: 0 }` and `freeformAnswerShape: { name: 3, place: 1, phrase: 1, title: 1, date: 0, number: 0, other: 1 }` and `seasons: { enabled: true, prompt: "Monthly" }` but no `questionType`, `contexts`, `difficulty`, or `offDays`
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.answersFormat` matches the stored value
- **AND** `workspaceDefaults.freeformAnswerShape` matches the stored value
- **AND** `workspaceDefaults.seasons` matches the stored value
- **AND** `workspaceDefaults.questionType` is absent
- **AND** `workspaceDefaults.contexts` is absent
- **AND** `workspaceDefaults.difficulty` is absent
- **AND** `workspaceDefaults.offDays` is absent

#### Scenario: Empty workspace defaults still present in response

- **GIVEN** `config.trivia` has no axis configuration set at all (only `games` populated)
- **WHEN** `list_games` is called
- **THEN** the response includes a `workspaceDefaults` key
- **AND** `workspaceDefaults` is `{}` (empty object)

#### Scenario: Empty config returns empty array

- **GIVEN** `config.trivia.games[]` is absent or empty
- **WHEN** `list_games` is called
- **THEN** the response is `{ games: [], workspaceDefaults: {...}, total: 0 }` (workspaceDefaults still reflects workspace tier)

#### Scenario: Tool is gated to member

- **WHEN** a session's user has role `member` or higher
- **THEN** `list_games` appears in the session's MCP catalog
