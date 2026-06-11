## MODIFIED Requirements

### Requirement: Trivia Games Config Schema

The system SHALL accept an optional `trivia.games: TriviaGame[]` array in `data/config.json`. Each entry declares one trivia game with its own channel and up to four schedules (optional prep + question + reveal + optional lock):

```ts
interface TriviaGame {
  name: string; // unique identifier within games[], used in specKey
  channel: string; // Slack channel ID (C…/G…/D…)
  prepCron?: string; // OPTIONAL cron expression for pre-staging questions
  questionCron: string; // cron expression for question posting
  revealCron: string; // cron expression for answer reveal
  lockCron?: string; // OPTIONAL cron expression for freezing voting on posted questions
  timezone: string; // IANA timezone (e.g., "America/Montreal")
}
```

Validation rules: `name` is a non-empty string and unique within `games[]`; `channel` matches `^[CGD][A-Z0-9]+$`; `questionCron`, `revealCron`, and (when present) `prepCron` / `lockCron` parse successfully via `cron-parser`; `timezone` is a non-empty string.

A malformed `prepCron` SHALL NOT reject the entire game entry. The parser SHALL drop only the `prepCron` field with a logged warning naming the game and the offending value; the game still loads with `questionCron` and `revealCron` validated as today. A malformed `lockCron` SHALL be handled the same way — dropped with a logged warning, the rest of the game loading intact.

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

#### Scenario: Game without lockCron parses with no warning

- **GIVEN** a games entry has the standard fields set but no `lockCron`
- **WHEN** the config is loaded
- **THEN** the parsed `TriviaGame` has no `lockCron` field
- **AND** loading succeeds without warnings

#### Scenario: Game with valid lockCron parses

- **GIVEN** a games entry has `lockCron: "0 12 * * *"` alongside the standard fields
- **WHEN** the config is loaded
- **THEN** the parsed `TriviaGame` carries `lockCron: "0 12 * * *"`
- **AND** loading succeeds without warnings

#### Scenario: Malformed lockCron is dropped with a warning

- **GIVEN** a games entry has `lockCron: "not a cron expression"` alongside otherwise-valid fields
- **WHEN** the config is loaded
- **THEN** the parsed `TriviaGame` has no `lockCron` field
- **AND** a structured warning is logged naming the game and the offending value
- **AND** the game still loads with all other fields intact

## ADDED Requirements

### Requirement: buildGameSpecs emits a lock spec when lockCron is set

The `buildGameSpecs` function SHALL emit an ADDITIONAL `CronJobSpec` with `specKey: \`${game.name}:lock\`` for a game whose `game.lockCron` is set, in addition to whatever question/reveal (and optional prep) specs it already emits. When `game.lockCron` is absent, NO lock spec SHALL be emitted and the spec set SHALL be identical to the pre-change behavior.

The lock spec SHALL have:

- `specKey: \`${game.name}:lock\``
- `name: \`Trivia: ${game.name} — lock\``
- `cronExpression: game.lockCron`
- **No `channel` field** (channelless — it edits existing cards via `chat.update` and posts nothing)
- `timezone: game.timezone`
- `prompt`: instructions directing Claude to call `lock_questions` for the game
- `requiredTools: ["mcp__trivia__lock_questions"]` — NOTABLY absent: `mcp__trivia__post_questions`
- `submitResponseMode: "skipped"`
- `attachedTopics: ["trivia"]`
- `skipDates: game.skipDates` (same propagation as the other specs)

#### Scenario: Lock spec emitted when lockCron is set

- **GIVEN** a game with valid `questionCron`, `revealCron`, and `lockCron`
- **WHEN** `buildGameSpecs([game])` is called
- **THEN** the returned spec list includes a spec whose `specKey` is `<name>:lock`
- **AND** that spec has no `channel` field and `submitResponseMode: "skipped"`
- **AND** its `requiredTools` is `["mcp__trivia__lock_questions"]` and does NOT contain `mcp__trivia__post_questions`

#### Scenario: No lock spec when lockCron is absent

- **GIVEN** a game with valid `questionCron` and `revealCron` but no `lockCron`
- **WHEN** `buildGameSpecs([game])` is called
- **THEN** no spec with a `<name>:lock` key is present
- **AND** the spec set matches the pre-change behavior exactly

#### Scenario: skipDates propagate to the lock spec

- **GIVEN** a game with `lockCron` set
- **AND** `config.trivia.offDays` produces a non-empty `skipDates`
- **WHEN** `buildGameSpecs` is called
- **THEN** the emitted lock spec carries the same `skipDates` array as the question and reveal specs
