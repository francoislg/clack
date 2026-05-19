## MODIFIED Requirements

### Requirement: Trivia Plugin Reconciles Schedules From Config

The trivia plugin's init function SHALL read `config.trivia.games[]` on every invocation (boot + every `restartAll`) and call `sdk.reconcileCronJobs("trivia", specs)` with the derived specs. There SHALL be two specs per game: one for question posting (`specKey: "<name>:question"`) and one for answer reveal (`specKey: "<name>:reveal"`). Each spec's `prompt` field SHALL embed the full substantive instructions text (from `scheduledPrompts.ts`), not a thin dispatcher.

The question spec's `prompt` SHALL match `SEND_QUESTIONS_INSTRUCTIONS` (with the `{game}` placeholder substituted). The reveal spec's `prompt` SHALL match `PROCESS_REVEAL_INSTRUCTIONS` (with the `{game}` placeholder substituted) — a renderer-brief prompt that calls `process_reveal_answers` and renders the returned payload. The reveal prompt's content SHALL NOT vary with `trivia.seasons.enabled`; seasons-specific rendering is driven by the `seasonStatus` field of the tool's payload.

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

#### Scenario: Reveal prompt is identical regardless of seasons flag

- **GIVEN** `config.trivia.games = [{ name: "ops", ... }]`
- **WHEN** the trivia plugin's init runs once with `trivia.seasons.enabled === false` and once with `trivia.seasons.enabled === true`
- **THEN** the `ops:reveal` spec's `prompt` is byte-identical in both runs

### Requirement: Required Tools Derive From Seasons Gate

For each game's two specs, the `requiredTools` array SHALL be:

- **Question spec** `requiredTools`: `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]` (independent of seasons; unchanged).
- **Reveal spec** `requiredTools`: `["mcp__trivia__process_reveal_answers"]` — a single-tool list. The reveal job's only hot-path tool is the new `process_reveal_answers` tool, which internally absorbs the deterministic work previously performed by `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, and `check_season_status`.

The reveal spec's `requiredTools` list SHALL NOT vary with `trivia.seasons.enabled`. Seasons-specific behavior (the `seasonStatus` field, season rollover) lives inside `process_reveal_answers`. Neither `mcp__trivia__check_season_status` nor `mcp__trivia__upsert_season` nor `mcp__trivia__delete_season` SHALL appear in the reveal spec's `requiredTools` — they are not invoked by the reveal hot path under any seasons configuration.

#### Scenario: Reveal spec requiredTools is the single-tool list when seasons are disabled

- **GIVEN** `config.trivia.seasons.enabled === false` (or absent)
- **WHEN** the trivia plugin builds the reveal spec for any game
- **THEN** the spec's `requiredTools` equals `["mcp__trivia__process_reveal_answers"]`
- **AND** does NOT include `mcp__clack__fetch_channel_messages`, `mcp__trivia__find_previous_questions`, `mcp__trivia__get_question_history`, `mcp__trivia__submit_answers`, or `mcp__trivia__retrieve_scores`

#### Scenario: Reveal spec requiredTools is the same single-tool list when seasons are enabled

- **GIVEN** `config.trivia.seasons.enabled === true`
- **WHEN** the trivia plugin builds the reveal spec for any game
- **THEN** the spec's `requiredTools` equals `["mcp__trivia__process_reveal_answers"]`
- **AND** the list is byte-identical to the seasons-disabled case
- **AND** does NOT include `mcp__trivia__check_season_status`, `mcp__trivia__upsert_season`, or `mcp__trivia__delete_season`
