## ADDED Requirements

### Requirement: Trivia Games Config Schema

The system SHALL accept an optional `trivia.games: TriviaGame[]` array in `data/config.json`. Each entry declares one trivia game with its own channel and two schedules (question + reveal):

```ts
interface TriviaGame {
  name: string;              // unique identifier within games[], used in specKey
  channel: string;           // Slack channel ID (C…/G…/D…)
  questionCron: string;      // cron expression for question posting
  revealCron: string;        // cron expression for answer reveal
  timezone: string;          // IANA timezone (e.g., "America/Montreal")
}
```

Validation rules: `name` is a non-empty string and unique within `games[]`; `channel` matches `^[CGD][A-Z0-9]+$`; both crons parse successfully via `cron-parser`; `timezone` is a non-empty string.

#### Scenario: Absent games array is valid

- **GIVEN** `data/config.json` has no `trivia.games` field
- **WHEN** the config is loaded
- **THEN** the parsed config has `trivia.games === undefined`
- **AND** loading succeeds without warnings

#### Scenario: Empty games array is valid

- **GIVEN** `data/config.json` has `trivia.games: []`
- **WHEN** the config is loaded
- **THEN** the parsed config has `trivia.games === []`
- **AND** loading succeeds without warnings

#### Scenario: Valid games array parses through

- **GIVEN** `data/config.json` has `trivia.games: [{ name: "ops-daily", channel: "C123", questionCron: "0 9 * * 1-5", revealCron: "0 15 * * 1-5", timezone: "America/Montreal" }]`
- **WHEN** the config is loaded
- **THEN** the parsed `trivia.games` contains one entry with those fields

#### Scenario: Invalid cron is rejected at load time

- **GIVEN** a games entry whose `questionCron` is `"not a cron expression"`
- **WHEN** the config is loaded
- **THEN** a warning is logged identifying the game by `name` and the offending field
- **AND** the invalid entry is dropped from the parsed `games[]` (loading does not throw)

#### Scenario: Invalid channel shape is rejected

- **GIVEN** a games entry whose `channel` is `"#general"` (not a channel ID)
- **WHEN** the config is loaded
- **THEN** a warning is logged identifying the game by `name`
- **AND** the invalid entry is dropped from the parsed `games[]`

#### Scenario: Duplicate names are rejected

- **GIVEN** `games[]` contains two entries both named `"ops-daily"`
- **WHEN** the config is loaded
- **THEN** the second entry is dropped with a warning identifying the duplicate
- **AND** the first entry is retained

### Requirement: Trivia Plugin Reconciles Schedules From Config

The trivia plugin's init function SHALL read `config.trivia.games[]` on every invocation (boot + every `restartAll`) and call `sdk.reconcileCronJobs("trivia", specs)` with the derived specs. There SHALL be two specs per game: one for question posting (`specKey: "<name>:question"`) and one for answer reveal (`specKey: "<name>:reveal"`). Each spec's `prompt` field SHALL embed the full substantive instructions text (from `scheduledPrompts.ts`), not a thin dispatcher.

#### Scenario: Empty games triggers reconcile with no specs

- **GIVEN** `config.trivia.games` is absent or `[]`
- **WHEN** the trivia plugin's init runs
- **THEN** `sdk.reconcileCronJobs("trivia", [])` is called
- **AND** any pre-existing `plugin === "trivia" && pluginManaged === true` jobs are deleted

#### Scenario: One game produces two specs

- **GIVEN** `config.trivia.games = [{ name: "ops", channel: "C1", questionCron: "0 9 * * 1-5", revealCron: "0 15 * * 1-5", timezone: "America/Montreal" }]`
- **WHEN** the trivia plugin's init runs
- **THEN** `sdk.reconcileCronJobs("trivia", specs)` is called with two specs
- **AND** the specs' `specKey` values are `"ops:question"` and `"ops:reveal"` respectively
- **AND** both specs share `channel === "C1"` and `timezone === "America/Montreal"`
- **AND** the question spec's `cronExpression === "0 9 * * 1-5"`
- **AND** the reveal spec's `cronExpression === "0 15 * * 1-5"`
- **AND** the question spec's `prompt` includes the boolean and choice path text from `SEND_QUESTIONS_INSTRUCTIONS`
- **AND** the reveal spec's `prompt` matches `getProcessResponsesInstructions(seasonsEnabled)`

#### Scenario: Multi-game produces 2N specs

- **GIVEN** three games in `config.trivia.games`
- **WHEN** the trivia plugin's init runs
- **THEN** six specs are passed to `reconcileCronJobs` (two per game)

### Requirement: Required Tools Derive From Seasons Gate

For each game's two specs, the `requiredTools` array SHALL be derived from the workspace `trivia.seasons.enabled` flag at reconcile time:

- **Question spec** `requiredTools`: `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]` (independent of seasons).
- **Reveal spec** `requiredTools`: `["mcp__clack__fetch_channel_messages", "mcp__trivia__find_previous_questions", "mcp__trivia__get_question_history", "mcp__trivia__submit_answers", "mcp__trivia__retrieve_scores"]`. When `trivia.seasons.enabled === true`, ALSO append `"mcp__trivia__check_season_status"`.

`mcp__trivia__upsert_season` and `mcp__trivia__delete_season` SHALL NOT appear in `requiredTools` even when seasons are enabled — they are conditionally called (end-of-season rollover, admin retraction) and would block every other day's reveal if required.

#### Scenario: Reveal spec omits check_season_status when seasons disabled

- **GIVEN** `config.trivia.seasons.enabled === false` (or absent)
- **WHEN** the trivia plugin builds the reveal spec for any game
- **THEN** the spec's `requiredTools` does NOT include `"mcp__trivia__check_season_status"`

#### Scenario: Reveal spec includes check_season_status when seasons enabled

- **GIVEN** `config.trivia.seasons.enabled === true`
- **WHEN** the trivia plugin builds the reveal spec for any game
- **THEN** the spec's `requiredTools` includes `"mcp__trivia__check_season_status"`
- **AND** does NOT include `"mcp__trivia__upsert_season"` or `"mcp__trivia__delete_season"`

### Requirement: Reveal-Before-Question Warning

When constructing specs for a game, the trivia plugin SHALL compare the next-fire times of `questionCron` and `revealCron` in the game's `timezone`. If, for any matching day-of-week, the reveal would fire on the same date earlier than the question, the plugin SHALL log a warning identifying the game by `name`. The plugin SHALL still produce the specs (the warning does not block reconcile).

#### Scenario: Inverted timing logs a warning

- **GIVEN** a game with `questionCron: "0 15 * * 1-5"` and `revealCron: "0 9 * * 1-5"` (reveal at 9am, question at 3pm)
- **WHEN** the trivia plugin reconciles
- **THEN** a warning is logged identifying the game's `name` and the inversion
- **AND** both specs are still passed to `reconcileCronJobs`

#### Scenario: Correct ordering does not warn

- **GIVEN** a game with `questionCron: "0 9 * * 1-5"` and `revealCron: "0 15 * * 1-5"`
- **WHEN** the trivia plugin reconciles
- **THEN** no warning is logged
