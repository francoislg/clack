## MODIFIED Requirements

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
