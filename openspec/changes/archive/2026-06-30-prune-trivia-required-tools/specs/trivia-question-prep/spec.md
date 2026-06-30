## RENAMED Requirements

- FROM: `### Requirement: Prep cron tool allowlist excludes post_questions`
- TO: `### Requirement: Prep cron required-tools list is the always-run discovery pair`

## MODIFIED Requirements

### Requirement: Optional prep cron on TriviaGame

The Trivia plugin SHALL accept an optional `prepCron: string` field on `TriviaGame`. When present, the field SHALL be a valid cron expression evaluated in the game's declared `timezone`. When absent, the game SHALL retain today's two-cron behavior (question + reveal only).

The parser SHALL validate `prepCron` via the existing cron-expression validator. Malformed values SHALL be dropped at parse time with a logged warning naming the offending value; the game SHALL still load with no prep cron emitted.

#### Scenario: Game with prepCron emits three cron specs

- **GIVEN** `config.trivia.games[0] = { name: "main", channel: "C123", prepCron: "30 8 * * *", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "America/New_York" }`
- **WHEN** the trivia plugin loads and calls `buildGameSpecs(games)`
- **THEN** the returned spec list contains exactly three specs for game `main`: `main:prep`, `main:question`, `main:reveal`
- **AND** the prep spec is channelless (no `channel` field)
- **AND** the prep spec's `requiredTools` is `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions"]` — it does NOT include `mcp__trivia__save_question` (a full pool legitimately no-ops, calling `save_question` zero times) or `mcp__trivia__post_questions`
- **AND** the prep spec's `submitResponseMode` is `"skipped"`
- **AND** the prep spec's `attachedTopics` includes `"trivia"`

#### Scenario: Game without prepCron emits two cron specs

- **GIVEN** `config.trivia.games[0]` has no `prepCron` field
- **WHEN** `buildGameSpecs` is called
- **THEN** the returned spec list contains exactly two specs for that game: `<name>:question` and `<name>:reveal`
- **AND** the question spec's `requiredTools` includes `mcp__trivia__post_questions` when the game is not flexible

#### Scenario: Malformed prepCron is dropped with a warning

- **GIVEN** `config.trivia.games[0].prepCron = "not a cron"`
- **WHEN** the games parser runs
- **THEN** the `prepCron` field is dropped from the parsed result
- **AND** a structured warning is logged naming the game and the offending value
- **AND** the game still loads with the other fields preserved, emitting two specs (no prep)

#### Scenario: skipDates propagate to the prep spec

- **GIVEN** a game has `prepCron` set
- **AND** `config.trivia.offDays` contains at least one entry
- **WHEN** `buildGameSpecs` is called
- **THEN** the prep spec's `skipDates` matches the question and reveal specs' `skipDates` exactly

### Requirement: Prep cron required-tools list is the always-run discovery pair

The cron spec emitted for `<name>:prep` SHALL declare a `requiredTools` list of exactly `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions"]` — the two read-only discovery calls the prep prompt makes on every run (the staged-pool check and the idea roll). It SHALL NOT include `mcp__trivia__save_question`: a prep fire whose pool is already full correctly generates nothing, so `save_question` is called zero times and gating on it would force the run to fabricate a question. It SHALL NOT include `mcp__trivia__post_questions`.

The prep run's inability to post a Slack message is enforced structurally by the channelless cron declaration (which restricts `submit_response` to `{ skip_response: true }`), NOT by the `requiredTools` list — `requiredTools` is the must-call gate and does not restrict which tools are available to the run.

#### Scenario: Prep required-tools list excludes save_question and post_questions

- **GIVEN** the prep cron spec has been emitted
- **WHEN** its `requiredTools` is inspected
- **THEN** it equals `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions"]`
- **AND** it does NOT include `mcp__trivia__save_question` or `mcp__trivia__post_questions`

#### Scenario: Full-pool prep fire terminates without save_question

- **GIVEN** a prep fire begins with every slot already staged in the pool
- **WHEN** the run generates no new questions and calls `submit_response({ skip_response: true })`
- **THEN** the required-tools gate does NOT block termination on a missing `save_question` call
- **AND** the run terminates cleanly without fabricating a question
