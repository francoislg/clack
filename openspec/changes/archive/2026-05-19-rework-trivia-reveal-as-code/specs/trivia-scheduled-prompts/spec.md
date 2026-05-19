## MODIFIED Requirements

### Requirement: Schedule Prompts Are Thin Dispatchers

Cron jobs reconciled by `sdk.reconcileCronJobs("trivia", specs)` from `config.trivia.games[]` SHALL carry full prompts inlined by `buildGameSpecs()`. Each spec's `prompt` SHALL embed the game's `name` at the top (`"Game: <name>. ..."`) and pass `game: "<name>"` literally to every trivia tool call referenced in the prompt's step sequence.

The prompt text itself SHALL come from constants in `src/plugins/trivia/scheduledPrompts.ts`:

- `SEND_QUESTIONS_INSTRUCTIONS` for the question-posting spec (`<name>:question`). Unchanged: this prompt remains the substantive Claude-driven flow for generating, validating, and posting a new question.
- `PROCESS_REVEAL_INSTRUCTIONS` for the reveal spec (`<name>:reveal`). This is a **renderer brief**, not a step-by-step orchestration prompt. It SHALL direct Claude to perform exactly two actions: (a) call `process_reveal_answers(game: "<name>")` and read its returned payload, then (b) render the payload as a Slack reveal using the Game Show Presenter persona via `submit_response`.

Both constants SHALL contain a `{game}` placeholder used at every tool-call reference and in a header line. `buildGameSpecs()` SHALL substitute `{game}` with the spec's `name` before assigning to `CronJobSpec.prompt`.

The persona directive ("PERSONA: You are a charismatic Game Show Presenter!...") SHALL be preserved at the top of both prompt constants. The substantive step flow for the question post (research, polarity self-check, duplicate check, difficulty gate, save, format, deliver) SHALL be preserved. For the reveal, the prompt is now structurally short — the deterministic work (find the pending question, fetch reactions, exclude bot + cheaters + multi-react voters, score answers, fetch the leaderboard, run season rollover when applicable) is performed inside `process_reveal_answers`; the prompt SHALL NOT enumerate these steps.

The `getProcessResponsesInstructions(seasonsEnabled)` function, the `buildSeasonsAwarePrompt()` helper, the `SEASONS_CHECK_STEP` constant, and the `SEASONS_LEADERBOARD_OVERRIDE` constant SHALL be removed. The reveal prompt is no longer seasons-aware via prompt mutation; seasons-specific rendering decisions are driven by the `seasonStatus` field of the tool's returned payload.

#### Scenario: buildGameSpecs substitutes the game name into both prompts

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "UTC", channel: "C123", enabled: true }`
- **WHEN** `buildGameSpecs([main], seasonsEnabled: false)` is called
- **THEN** the returned `specs` includes a `<name>:question` spec whose `prompt` contains the substring `Game: main` and references `game: "main"` at every tool-call step
- **AND** the returned `specs` includes a `<name>:reveal` spec whose `prompt` similarly contains `Game: main` and references `game: "main"` at every tool-call step

#### Scenario: Disabled games are excluded from buildGameSpecs output

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }` and `{ name: "main", enabled: true, ... }`
- **WHEN** `buildGameSpecs(games, ...)` is called
- **THEN** the returned `specs` includes `main:question` and `main:reveal`
- **AND** does NOT include `retired:question` or `retired:reveal`

#### Scenario: Per-game prompts are isolated from each other

- **GIVEN** `config.trivia.games[]` contains both `main` and `sandbox`
- **WHEN** `buildGameSpecs(games, ...)` is called
- **THEN** the `main:question` spec's prompt contains `game: "main"` and NOT `game: "sandbox"`
- **AND** the `sandbox:question` spec's prompt contains `game: "sandbox"` and NOT `game: "main"`

#### Scenario: Reveal prompt is a two-step renderer brief

- **GIVEN** `buildGameSpecs([{ name: "main", ... }], false)` was called
- **WHEN** the `main:reveal` spec's `prompt` is inspected
- **THEN** the prompt instructs Claude to call `process_reveal_answers(game: "main")`
- **AND** instructs Claude to render the returned payload using `submit_response`
- **AND** does NOT enumerate categorization, cheater-exclusion, submit_answers ordering, or any of the deterministic steps that now live in `process_reveal_answers`

#### Scenario: Seasons-aware prompt splicing is removed

- **WHEN** `src/plugins/trivia/scheduledPrompts.ts` is inspected
- **THEN** there is no `getProcessResponsesInstructions(seasonsEnabled)` export
- **AND** there is no `buildSeasonsAwarePrompt`, `SEASONS_CHECK_STEP`, or `SEASONS_LEADERBOARD_OVERRIDE` symbol
- **AND** the reveal prompt constant is a single string whose text does NOT branch on `seasons.enabled`

### Requirement: Answer-reveal prompt step flow

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL open with the Game Show Presenter persona directive and a "Game: {game}" header, then direct Claude through a renderer flow consisting of exactly two steps:

1. **Call `process_reveal_answers(game: "{game}")`** and read its returned payload. The prompt SHALL describe the payload's shape (the `reveals[]`, `leaderboard`, and optional `seasonStatus` fields) so Claude can render it without inventing structure.
2. **Render the payload via `submit_response`** using the Game Show Presenter voice and the Block Kit conventions previously used by the reveal flow:
   - A `header` block announcing the verdict (e.g. "🎯 THE ANSWER IS TRUE!", "🎲 IT'S FALSE!", or the equivalent for choice questions).
   - A `section` block explaining WHY the statement is true / false using the question's facts.
   - A `divider` block.
   - One `section` block per non-empty voter situation (correct / incorrect / fence-sitters [boolean only] / wildcards). Empty situations SHALL be omitted with no placeholder.
   - A `context` block as a closer that introduces the leaderboard.
   - A top-level `table` parameter rendering the leaderboard. When `seasonStatus` is present in the payload, the renderer SHALL use the 3-row dual-totals shape (names / Current Season / All Time); otherwise the 2-row shape (names / scores).
   - When `seasonStatus.isLastFireOfSeason` is `true`, the renderer SHALL include an extra `section` block above the leaderboard table summarizing the closing season and naming `seasonStatus.mvp`. The renderer SHALL NOT preview the new season's slug (that's left to a future fire to announce).

The prompt SHALL NOT enumerate cheater filtering, multi-react voiding, the order of `submit_answers` vs `submit_response`, `find_previous_questions` keyword search, or season rollover tool calls — all of those concerns are handled inside `process_reveal_answers` and absent from the payload. The prompt SHALL NOT reference `save_cheating`. The prompt SHALL NOT predict the timing of future reveals.

When the payload's `reveals` array is empty (no pending questions and no reprocessing requested), the renderer SHALL post an acknowledgement using the Game Show Presenter voice (e.g. "No verdict to deliver today — the question bank is quiet!"). The cumulative leaderboard table SHALL still render.

#### Scenario: Reveal prompt references the new tool by name

- **WHEN** the reveal prompt content is inspected
- **THEN** the returned text references `process_reveal_answers(game: "{game}")` as the first step
- **AND** does NOT reference `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, `check_season_status`, or `upsert_season` as required tool calls

#### Scenario: Reveal prompt does not enumerate deterministic steps

- **WHEN** the reveal prompt content is inspected
- **THEN** the text does NOT contain instructions to categorize voters, exclude the bot, exclude cheaters, void multi-react voters, or order `submit_answers` before `submit_response`
- **AND** the text does NOT contain "INTERNAL STEP, NEVER SURFACE" or analogous guardrail language for these steps (they are structurally absent from the payload)

#### Scenario: Reveal prompt describes the payload's seasonStatus shape

- **WHEN** the reveal prompt content is inspected
- **THEN** the text describes the optional `seasonStatus` field of the payload, including `isLastFireOfSeason`, `mvp`, and the renderer's branching rule (3-row leaderboard when `seasonStatus` is present, 2-row otherwise)
- **AND** instructs the renderer to add a finale `section` block above the leaderboard only when `isLastFireOfSeason` is `true`

#### Scenario: Empty reveals payload yields an acknowledgement message

- **WHEN** the reveal prompt content is inspected
- **THEN** the text directs Claude to post an in-persona acknowledgement when the payload's `reveals` array is `[]`
- **AND** instructs Claude to still render the cumulative leaderboard table in that case

### Requirement: requiredTools per spec

Each game's question spec SHALL have `requiredTools` equal to:

```
["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]
```

Each game's reveal spec SHALL have `requiredTools` equal to:

```
["mcp__trivia__process_reveal_answers"]
```

The reveal `requiredTools` list SHALL be the SAME regardless of `trivia.seasons.enabled`. Seasons-specific behavior is handled inside `process_reveal_answers`; the spec's required-tools list SHALL NOT vary with that flag.

#### Scenario: Question spec requiredTools

- **WHEN** `buildGameSpecs` produces a `<name>:question` spec
- **THEN** the spec's `requiredTools` includes (at minimum) `mcp__trivia__get_ideas`, `mcp__trivia__find_previous_questions`, and `mcp__trivia__save_question`

#### Scenario: Reveal spec requiredTools is a single-element list

- **GIVEN** `buildGameSpecs(games, seasonsEnabled: false)` is called
- **WHEN** the resulting `<name>:reveal` spec is inspected
- **THEN** `requiredTools` equals `["mcp__trivia__process_reveal_answers"]`
- **AND** does NOT include `mcp__clack__fetch_channel_messages`, `mcp__trivia__find_previous_questions`, `mcp__trivia__get_question_history`, `mcp__trivia__submit_answers`, `mcp__trivia__retrieve_scores`, or `mcp__trivia__check_season_status`

#### Scenario: Reveal spec requiredTools is identical when seasons are enabled

- **GIVEN** `buildGameSpecs(games, seasonsEnabled: true)` is called
- **WHEN** the resulting `<name>:reveal` spec is inspected
- **THEN** `requiredTools` equals `["mcp__trivia__process_reveal_answers"]`
- **AND** the list is byte-identical to the seasons-disabled case
