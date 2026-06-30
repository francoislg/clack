## RENAMED Requirements

- FROM: `### Requirement: Required Tools Derive From Seasons Gate`
- TO: `### Requirement: Required Tools Are Limited To Always-Called Tools`

## MODIFIED Requirements

### Requirement: Required Tools Are Limited To Always-Called Tools

A cron spec's `requiredTools` array SHALL contain ONLY tools that are invoked on 100% of valid runs of that spec. The `submit_response` required-tools gate force-calls every listed tool before accepting termination (its rejection message instructs Claude to call any not-yet-called tool), so listing a *conditional* tool — one the prompt invokes only sometimes (e.g. only for predictions, only on the season's last fire, only for image questions, only when fresh material exists) — causes the gate to force a spurious or state-mutating call on the runs where the tool does not apply. `requiredTools` is the must-call gate only; it does NOT restrict which tools are available to the run.

For each game's specs, the lists SHALL be (resolved at spec-build time by `buildGameSpecs` from the static `TriviaGame`, not re-evaluated per fire):

- **Question spec** `requiredTools`:
  - When `game.format?.flexible !== true`: `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]`. `get_ideas` opens every generation flow; `post_questions` is the guaranteed deliverable of a non-flexible fire (at least one question is always posted), so the gate ensures the run cannot terminate without dispatching it.
  - When `game.format?.flexible === true`: `["mcp__trivia__get_ideas"]`. A flexible fire may legitimately post zero questions, so `post_questions` is not guaranteed and SHALL NOT be required.
  - `mcp__trivia__find_previous_questions`, `mcp__trivia__find_previous_subjects`, and `mcp__trivia__save_question` SHALL NOT appear in the question list: the duplicate-check gate is skipped by some generation paths (e.g. predictions), `find_previous_subjects` runs only in the image subflow, and `save_question` is skipped when a slot is served from the staged pool.
- **Reveal spec** `requiredTools`: `["mcp__trivia__compute_answers"]` — a single-tool list. `compute_answers` is the only tool called on every reveal, including an empty batch (where it returns `reveals: []`). `mcp__trivia__settle_question`, `mcp__trivia__update_answers_block`, `mcp__trivia__start_new_season`, and `mcp__trivia__update_question` are each conditional and SHALL NOT appear.

The reveal spec's `requiredTools` SHALL NOT vary with `trivia.seasons.enabled`. Seasons-specific behavior (the `seasonStatus` field, season rollover via `start_new_season`) is invoked by the reveal prompt only when applicable, never on every fire, and therefore is not gated.

#### Scenario: Non-flexible question spec requiredTools

- **GIVEN** a game whose effective format is not flexible (`game.format?.flexible !== true`)
- **WHEN** the resulting `<name>:question` spec is inspected
- **THEN** `requiredTools` equals `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]`
- **AND** it does NOT include `mcp__trivia__find_previous_questions`, `mcp__trivia__find_previous_subjects`, or `mcp__trivia__save_question`

#### Scenario: Flexible game question spec omits post_questions

- **GIVEN** a game with `format.flexible === true`
- **WHEN** the resulting `<name>:question` spec is inspected
- **THEN** `requiredTools` equals `["mcp__trivia__get_ideas"]`
- **AND** it does NOT include `mcp__trivia__post_questions` (a flexible fire may legitimately post zero questions)

#### Scenario: Reveal spec requiredTools is the single-tool compute list

- **GIVEN** any game
- **WHEN** the trivia plugin builds the reveal spec
- **THEN** the spec's `requiredTools` equals `["mcp__trivia__compute_answers"]`
- **AND** it does NOT include `mcp__trivia__settle_question`, `mcp__trivia__update_answers_block`, `mcp__trivia__start_new_season`, or `mcp__trivia__update_question`

#### Scenario: Reveal requiredTools does not vary with seasons

- **GIVEN** two configs identical except `trivia.seasons.enabled` is `false` in one and `true` in the other
- **WHEN** the reveal spec is built for the same game under each config
- **THEN** both reveal specs' `requiredTools` equal `["mcp__trivia__compute_answers"]`
- **AND** the two lists are byte-identical
