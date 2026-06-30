# trivia-question-prep Specification

## Purpose

The trivia plugin's optional question pre-staging workflow. When a game is configured with `prepCron`, Claude runs a scheduled pre-cron that generates questions asynchronously into a staged pool, with the question-posting cron then checking the pool at fire time and falling back to inline generation for any missing slots.
## Requirements
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

### Requirement: Prep cron is channelless

The prep cron spec SHALL be channelless (`channel` field omitted on the `CronJobSpec`). Channelless declaration causes the SDK to restrict the run's `submit_response` schema to `{ skip_response: true }`, preventing Claude from delivering any Slack message via `submit_response` regardless of prompt instructions.

#### Scenario: Channelless prep cron blocks Slack delivery

- **GIVEN** the prep cron spec is emitted without a `channel`
- **WHEN** the prep run executes
- **THEN** `submit_response` is restricted by the SDK to `{ skip_response: true }`
- **AND** Claude cannot terminate the run with any Slack-bound `submit_response` payload

### Requirement: Prep prompt is gen-only and self-validates completeness

The PREP_QUESTIONS_INSTRUCTIONS prompt SHALL instruct Claude to:

1. Call `find_previous_questions({ games: ["<game>"], seasons: ["current"], posted: false, match: "all" })` to inspect the current staged pool.
2. Determine the active format (slot count and per-slot labels) via a `get_ideas({ slot: 0 })` call.
3. For each slot index in `[0..slotCount-1]` whose slot index is NOT already represented in the staged pool, run the standard per-slot generation flow (FACT-BOOLEAN, FACT-CHOICE, FACT-FREEFORM, TOPICAL-BOOLEAN, TOPICAL-CHOICE, or TOPICAL-FREEFORM as rolled by `get_ideas` for that slot) and persist via `save_question`.
4. After all slots are filled, re-call `find_previous_questions({ ..., posted: false })` to confirm every slot index in `[0..slotCount-1]` is now covered.
5. Terminate with `submit_response({ skip_response: true })`. The prompt SHALL NOT instruct Claude to build any Block Kit blocks and SHALL NOT reference `post_questions`.

#### Scenario: Prep recognizes already-filled slots

- **GIVEN** the staged pool already contains one question for slot 1 (e.g., admin-pre-generated via DM)
- **AND** the active format has slot count 3 (slots 0, 1, 2)
- **WHEN** the prep cron fires and Claude runs the PREP prompt
- **THEN** Claude calls `find_previous_questions` and sees slot 1 already filled
- **AND** Claude generates only for slots 0 and 2
- **AND** the final staged pool contains exactly 3 questions, one per slot

#### Scenario: Prep is a no-op when the pool is already complete

- **GIVEN** the staged pool already contains one question per slot index for the active format
- **WHEN** the prep cron fires
- **THEN** Claude runs only the staged-pool query and the format-meta query
- **AND** Claude calls `save_question` zero times
- **AND** the run terminates with `submit_response({ skip_response: true })`

### Requirement: Inline-generation fallback at post time

The POST_QUESTIONS_INSTRUCTIONS prompt SHALL include an inline-generation fallback for any format slot that has no staged question at post-cron fire time. When the staged pool query returns fewer questions than the format's slot count, Claude SHALL generate the missing slots inline (per the same FACT/CHOICE/TOPICAL/FREEFORM matrix used at PREP) before assembling and posting the message.

The same prompt SHALL drive the question cron regardless of whether the game has `prepCron` configured — when `prepCron` is absent, the staged pool query naturally returns nothing and the inline-gen branch covers every slot, replicating today's gen-and-post behavior.

#### Scenario: Post falls back to inline generation when prep is incomplete

- **GIVEN** the staged pool for game `main` contains questions for slots 0 and 2 only (slot 1 missing — prep failed earlier)
- **AND** the active format has 3 slots
- **WHEN** the question cron fires and Claude runs the POST prompt
- **THEN** Claude reads the staged pool and identifies slot 1 as missing
- **AND** Claude runs the per-slot generation flow for slot 1 inline, calling `save_question` for it
- **AND** Claude assembles the 3-item batch (staged-0, fresh-1, staged-2 in slot order)
- **AND** Claude calls `post_questions({ items: [...] })` with all three items

#### Scenario: Post with no prepCron behaves identically to pre-change behavior

- **GIVEN** game `main` has no `prepCron` configured
- **AND** the staged pool is empty
- **WHEN** the question cron fires
- **THEN** Claude's staged-pool query returns zero results
- **AND** Claude inline-generates every slot in the format
- **AND** Claude assembles the message and calls `post_questions`
- **AND** the resulting Slack posts are indistinguishable from the pre-change behavior for this configuration

### Requirement: Post-time pool selection is season-scoped and FIFO per slot

When picking from the staged pool at post time, POST_QUESTIONS_INSTRUCTIONS SHALL pass `seasons: ["current"]` to `find_previous_questions` so only questions whose `season` matches the active season slug are considered. When multiple staged questions exist for the same slot index (e.g., from accumulated unfired prep runs), Claude SHALL select the OLDEST by `createdAt`.

Stranded staged questions belonging to a closed season SHALL remain on disk untouched but SHALL NOT be picked.

#### Scenario: Season rollover orphans pre-existing staged questions

- **GIVEN** the staged pool contains questions stamped with season `"a"` for slots 0 and 1
- **AND** a season rollover occurs between prep and post, making the current season `"b"`
- **WHEN** the question cron fires and Claude runs the POST prompt
- **THEN** the staged-pool query returns zero rows (the season filter excludes the orphans)
- **AND** Claude inline-generates every slot for season `"b"`
- **AND** the orphaned season-`"a"` records remain on disk untouched

#### Scenario: Oldest staged is picked when multiple exist per slot

- **GIVEN** the staged pool contains two questions for slot 0 — `q_old` (createdAt earlier) and `q_new` (createdAt later)
- **WHEN** Claude picks for slot 0
- **THEN** Claude selects `q_old`
- **AND** `q_new` remains staged for the next question-cron fire

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

