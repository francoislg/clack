# trivia-managed-schedules Specification

## Purpose

TBD - created by archiving change add-trivia-games. Update Purpose after archive.

## Requirements

### Requirement: Trivia Games Config Schema

The system SHALL accept an optional `trivia.games: TriviaGame[]` array in `data/config.json`. Each entry declares one trivia game with its own channel and two schedules (question + reveal):

```ts
interface TriviaGame {
  name: string; // unique identifier within games[], used in specKey
  channel: string; // Slack channel ID (C…/G…/D…)
  questionCron: string; // cron expression for question posting
  revealCron: string; // cron expression for answer reveal
  timezone: string; // IANA timezone (e.g., "America/Montreal")
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
- **AND** the reveal spec's `prompt` matches `PROCESS_REVEAL_INSTRUCTIONS` with `{game}` substituted to `"ops"`

#### Scenario: Multi-game produces 2N specs

- **GIVEN** three games in `config.trivia.games`
- **WHEN** the trivia plugin's init runs
- **THEN** six specs are passed to `reconcileCronJobs` (two per game)

### Requirement: Required Tools Derive From Seasons Gate

For each game's two specs, the `requiredTools` array SHALL be:

- **Question spec** `requiredTools`: `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question", "mcp__trivia__post_questions"]`. The `post_questions` entry ensures the cron run cannot terminate without having dispatched the question to Slack and stamped its `postedAt`/`messageLink` on the question record. The list is independent of seasons.
- **Reveal spec** `requiredTools`: `["mcp__trivia__process_reveal_answers"]` — a single-tool list. The reveal job's only hot-path tool is the `process_reveal_answers` tool, which internally absorbs the deterministic work previously performed by `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, and `check_season_status`.

The reveal spec's `requiredTools` list SHALL NOT vary with `trivia.seasons.enabled`. Seasons-specific behavior (the `seasonStatus` field, season rollover) lives inside `process_reveal_answers`. Neither `mcp__trivia__check_season_status` nor `mcp__trivia__upsert_season` nor `mcp__trivia__delete_season` SHALL appear in the reveal spec's `requiredTools` — they are not invoked by the reveal hot path under any seasons configuration.

#### Scenario: Question spec requiredTools includes post_questions

- **GIVEN** `buildGameSpecs(games, ...)` is called
- **WHEN** the resulting `<name>:question` spec is inspected
- **THEN** `requiredTools` includes `mcp__trivia__post_questions` alongside `mcp__trivia__get_ideas`, `mcp__trivia__find_previous_questions`, and `mcp__trivia__save_question`
- **AND** the list is the same regardless of `trivia.seasons.enabled`

#### Scenario: Reveal spec requiredTools is the single-tool list when seasons are disabled

- **GIVEN** `config.trivia.seasons.enabled === false` (or absent)
- **WHEN** the trivia plugin builds the reveal spec for any game
- **THEN** the spec's `requiredTools` equals `["mcp__trivia__process_reveal_answers"]`
- **AND** does NOT include `mcp__clack__fetch_channel_messages`, `mcp__trivia__find_previous_questions`, `mcp__trivia__get_question_history`, `mcp__trivia__submit_answers`, `mcp__trivia__retrieve_scores`, or `mcp__trivia__post_questions`

#### Scenario: Reveal spec requiredTools is the same single-tool list when seasons are enabled

- **GIVEN** `config.trivia.seasons.enabled === true`
- **WHEN** the trivia plugin builds the reveal spec for any game
- **THEN** the spec's `requiredTools` equals `["mcp__trivia__process_reveal_answers"]`
- **AND** the list is byte-identical to the seasons-disabled case
- **AND** does NOT include `mcp__trivia__check_season_status`, `mcp__trivia__upsert_season`, `mcp__trivia__delete_season`, or `mcp__trivia__post_questions`

### Requirement: Trivia Off-Days Config

The system SHALL accept an optional `trivia.offDays: OffDay[]` array in `data/config.json`. This is a plugin-level list shared by every entry in `trivia.games[]`; there is no per-game override.

```ts
interface OffDay {
  /** Either YYYY-MM-DD (exact date) or MM-DD (recurring annually). Interpreted in the matching cron job's timezone. */
  date: string;
  /** Human-readable label used in logs and Home Tab display. Required, non-empty. */
  label: string;
}
```

Validation rules:

- `date` SHALL match either `^\d{4}-\d{2}-\d{2}$` (exact date) or `^\d{2}-\d{2}$` (recurring), AND SHALL represent a real calendar date (no `02-30`, no `13-01`).
- `label` SHALL be a non-empty string.
- Invalid entries SHALL be dropped with a logged warning identifying the array index and the failed rule. Loading SHALL NOT throw — the rest of the config loads normally.

#### Scenario: Absent offDays is valid

- **GIVEN** `data/config.json` has no `trivia.offDays` field
- **WHEN** the config is loaded
- **THEN** the parsed config has `trivia.offDays === undefined`
- **AND** loading succeeds without warnings

#### Scenario: Empty offDays is valid

- **GIVEN** `data/config.json` has `trivia.offDays: []`
- **WHEN** the config is loaded
- **THEN** the parsed config has `trivia.offDays === []`
- **AND** loading succeeds without warnings

#### Scenario: Mixed exact + recurring dates parse through

- **GIVEN** `trivia.offDays: [{ date: "12-25", label: "Christmas" }, { date: "2026-04-03", label: "Good Friday 2026" }]`
- **WHEN** the config is loaded
- **THEN** both entries are present in the parsed `trivia.offDays`

#### Scenario: Unparseable date format warns and drops

- **GIVEN** an entry with `date: "December 25"` and `label: "Christmas"`
- **WHEN** the config is loaded
- **THEN** a warning is logged identifying the entry index and the date-format violation
- **AND** the entry is omitted from the parsed `trivia.offDays`

#### Scenario: Invalid calendar date warns and drops

- **GIVEN** an entry with `date: "02-30"` and `label: "Imaginary"`
- **WHEN** the config is loaded
- **THEN** a warning is logged identifying the entry as not a real calendar date
- **AND** the entry is omitted

#### Scenario: Missing label warns and drops

- **GIVEN** an entry with `date: "12-25"` and no `label` field (or empty-string `label`)
- **WHEN** the config is loaded
- **THEN** a warning is logged identifying the missing label
- **AND** the entry is omitted

#### Scenario: Valid entries are kept when other entries are invalid

- **GIVEN** `trivia.offDays: [{ date: "12-25", label: "Christmas" }, { date: "bogus", label: "x" }]`
- **WHEN** the config is loaded
- **THEN** the Christmas entry is present in the parsed `trivia.offDays`
- **AND** the `"bogus"` entry is dropped with a warning

### Requirement: Off-Days Propagation Through Game Specs

`buildGameSpecs(games, seasonsEnabled, offDays?)` SHALL accept an `offDays` parameter and propagate it into every emitted spec's `skipDates` field. The trivia plugin's init SHALL read `config.trivia.offDays` and pass it to `buildGameSpecs`.

When `offDays` is absent or empty, the emitted specs SHALL omit the `skipDates` field entirely (no empty-array writes).

#### Scenario: offDays propagates into every spec

- **GIVEN** `config.trivia.games` with two entries and `config.trivia.offDays: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** `buildGameSpecs` runs
- **THEN** all four emitted specs (two games × question + reveal) have `skipDates: [{ date: "12-25", label: "Christmas" }]`

#### Scenario: Absent offDays yields specs without skipDates

- **GIVEN** `config.trivia.games` with one entry and no `config.trivia.offDays`
- **WHEN** `buildGameSpecs` runs
- **THEN** both emitted specs have `skipDates === undefined` (the field is not present in the spec object)

#### Scenario: Updating offDays re-reconciles in place

- **GIVEN** a plugin-managed trivia cron job with `skipDates: [{ date: "12-25", label: "Christmas" }]`
- **WHEN** `config.trivia.offDays` is edited to `[{ date: "12-25", label: "Christmas" }, { date: "01-01", label: "New Year's Day" }]` and the trivia plugin re-runs reconcile
- **THEN** the same job now has both entries in `skipDates`
- **AND** the job's `id`, `runs[]`, and `enabled` are preserved

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

### Requirement: Question Spec Declares submitResponseMode "skipped"

For every game emitted by `buildGameSpecs`, the question spec (`<name>:question`) SHALL set `submitResponseMode: "skipped"`. The reveal spec (`<name>:reveal`) SHALL leave `submitResponseMode` unset.

The rationale: the question's actual deliverable is produced by `post_questions` (a plugin-owned MCP tool that posts the Slack message and stamps `postedAt`/`messageLink` on the question record). `submit_response` for this run is purely the run terminator. Declaring `"skipped"` constrains its schema to `{ skip_response: true }` so Claude cannot accidentally deliver a stray confirmation message that would duplicate the real question post.

The reveal spec renders an actual user-facing message (the answer reveal with leaderboard), so it remains under the default auto-derivation rules — `submitResponseMode` is left unset and `submit_response` accepts a normal delivery.

#### Scenario: Question spec has submitResponseMode "skipped"

- **GIVEN** any game in `config.trivia.games[]` with `enabled !== false`
- **WHEN** `buildGameSpecs([game])` is called
- **THEN** the returned `<game.name>:question` spec has `submitResponseMode === "skipped"`

#### Scenario: Reveal spec leaves submitResponseMode unset

- **GIVEN** any game in `config.trivia.games[]` with `enabled !== false`
- **WHEN** `buildGameSpecs([game])` is called
- **THEN** the returned `<game.name>:reveal` spec has `submitResponseMode === undefined`

#### Scenario: Disabled games emit no specs (including no submitResponseMode declarations)

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `buildGameSpecs(games)` is called
- **THEN** no specs are emitted for `retired` (neither question nor reveal)
- **AND** no `submitResponseMode` declarations leak through for disabled games

#### Scenario: reconcileCronJobs propagates submitResponseMode to persisted jobs

- **GIVEN** `buildGameSpecs` emits a question spec with `submitResponseMode: "skipped"`
- **WHEN** the trivia plugin calls `sdk.reconcileCronJobs("trivia", specs)`
- **THEN** the resulting persisted cron job carries `submitResponseMode: "skipped"`
- **AND** subsequent runs of that cron use the skipped-only `submit_response` schema (see the `submit-response-mode` capability)
