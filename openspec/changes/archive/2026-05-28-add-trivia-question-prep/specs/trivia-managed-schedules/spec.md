## MODIFIED Requirements

### Requirement: Trivia Games Config Schema

The system SHALL accept an optional `trivia.games: TriviaGame[]` array in `data/config.json`. Each entry declares one trivia game with its own channel and up to three schedules (optional prep + question + reveal):

```ts
interface TriviaGame {
  name: string; // unique identifier within games[], used in specKey
  channel: string; // Slack channel ID (C…/G…/D…)
  prepCron?: string; // OPTIONAL cron expression for pre-staging questions
  questionCron: string; // cron expression for question posting
  revealCron: string; // cron expression for answer reveal
  timezone: string; // IANA timezone (e.g., "America/Montreal")
}
```

Validation rules: `name` is a non-empty string and unique within `games[]`; `channel` matches `^[CGD][A-Z0-9]+$`; `questionCron`, `revealCron`, and (when present) `prepCron` parse successfully via `cron-parser`; `timezone` is a non-empty string.

A malformed `prepCron` SHALL NOT reject the entire game entry. The parser SHALL drop only the `prepCron` field with a logged warning naming the game and the offending value; the game still loads with `questionCron` and `revealCron` validated as today.

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

#### Scenario: Game without prepCron parses with no warning

- **GIVEN** a games entry has `questionCron`, `revealCron`, `timezone`, `name`, `channel` set, but no `prepCron`
- **WHEN** the config is loaded
- **THEN** the parsed `TriviaGame` has no `prepCron` field
- **AND** loading succeeds without warnings

#### Scenario: Game with valid prepCron parses

- **GIVEN** a games entry has `prepCron: "30 8 * * *"` alongside the standard fields
- **WHEN** the config is loaded
- **THEN** the parsed `TriviaGame` carries `prepCron: "30 8 * * *"`
- **AND** loading succeeds without warnings

#### Scenario: Malformed prepCron is dropped with a warning

- **GIVEN** a games entry has `prepCron: "not a cron expression"` alongside otherwise-valid fields
- **WHEN** the config is loaded
- **THEN** the parsed `TriviaGame` has no `prepCron` field
- **AND** a structured warning is logged naming the game and the offending value
- **AND** the game still loads with all other fields intact

## ADDED Requirements

### Requirement: buildGameSpecs emits a prep spec when prepCron is set

The `buildGameSpecs` function SHALL emit exactly three `CronJobSpec` entries per game when `game.prepCron` is set: `<name>:prep`, `<name>:question`, `<name>:reveal`. When `game.prepCron` is absent, the function SHALL emit only two specs (`<name>:question`, `<name>:reveal`) as in the pre-change behavior.

The prep spec SHALL have:

- `specKey: \`${game.name}:prep\``
- `name: \`Trivia: ${game.name} — prep\``
- `cronExpression: game.prepCron`
- **No `channel` field** (channelless)
- `timezone: game.timezone`
- `prompt: substituteGame(PREP_QUESTIONS_INSTRUCTIONS, game.name)`
- `requiredTools: PREP_REQUIRED_TOOLS` — the list `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]`. NOTABLY absent: `mcp__trivia__post_questions`.
- `submitResponseMode: "skipped"`
- `attachedTopics: ["trivia"]`
- `skipDates: game.skipDates` (same propagation as question and reveal)

#### Scenario: Three specs emitted when prepCron is set

- **GIVEN** a game with valid `prepCron`, `questionCron`, `revealCron`
- **WHEN** `buildGameSpecs([game])` is called
- **THEN** the returned spec list has length 3
- **AND** the spec keys, in order, are `<name>:prep`, `<name>:question`, `<name>:reveal`
- **AND** the prep spec has no `channel` field
- **AND** the prep spec's `requiredTools` does NOT contain `mcp__trivia__post_questions`

#### Scenario: Two specs emitted when prepCron is absent

- **GIVEN** a game with no `prepCron`, valid `questionCron`, `revealCron`
- **WHEN** `buildGameSpecs([game])` is called
- **THEN** the returned spec list has length 2
- **AND** the spec keys are `<name>:question`, `<name>:reveal`
- **AND** the behavior matches the pre-change spec set exactly

#### Scenario: skipDates propagate to all emitted specs

- **GIVEN** a game with `prepCron` set
- **AND** `config.trivia.offDays` contains entries that produce a non-empty `skipDates`
- **WHEN** `buildGameSpecs` is called
- **THEN** all three emitted specs (prep, question, reveal) have the same `skipDates` array

### Requirement: warnIfPrepAfterQuestion logs misconfiguration

When both `prepCron` and `questionCron` are valid, `buildGameSpecs` SHALL compute each cron's next fire time in the game's timezone via `CronExpressionParser`. If the prep cron's next fire is strictly AFTER the question cron's next fire on the next matching calendar date, the function SHALL log a structured warning naming the game and the two cron expressions. The specs SHALL still be created — the warning is advisory, not blocking.

#### Scenario: Misconfigured prep fires after question

- **GIVEN** a game with `questionCron: "0 9 * * *"` and `prepCron: "0 18 * * *"` in the same timezone
- **WHEN** `buildGameSpecs([game])` is called
- **THEN** the warning is logged describing the misconfiguration
- **AND** the spec list still contains the prep spec (with the misconfigured cron expression as authored)
