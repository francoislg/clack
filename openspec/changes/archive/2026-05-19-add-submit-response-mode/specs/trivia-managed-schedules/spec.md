## ADDED Requirements

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
