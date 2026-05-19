## ADDED Requirements

### Requirement: Reveal prompt branches on reveals.length

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL direct Claude to branch its rendering on the returned payload's `reveals.length`:

- **`reveals.length === 1`** (single-question fire): Use today's layout — header verdict, why-section, divider, full per-voter-bucket sections (correct / incorrect / fence-sitters [boolean only] / wildcards), context closer, cumulative leaderboard table. The `roundSummary` field SHALL be ignored in this branch (the single voter-bucket sections already convey the same information).

- **`reveals.length > 1`** (multi-question fire, produced by a season with a `format`): Render
  1. One `header` block introducing the multi-question reveal (e.g. "🎯 ROUND RECAP — N QUESTIONS!").
  2. ONE `section` block per question containing a brief verdict line ("Q1: TRUE! It's [statement-summary]. ⏤ [single-line voter teaser]" — e.g. "Alice and Bob nailed it; Carol fell for the trap"). The per-question section SHALL be ≤ 2 short sentences and SHALL NOT enumerate every voter individually.
  3. ONE `divider` block.
  4. ONE `section` block titled "Round Summary" listing each player from `roundSummary.perPlayer` as `<@USERID>: <correct>/<totalQuestions>` (or similar in-persona phrasing), with a `🏆` prefix on players carrying `roundMvp: true`. The order matches the payload's `perPlayer` order (sorted by correct desc, name asc).
  5. ONE `context` block as a closer.
  6. The top-level `table` parameter with the cumulative leaderboard (same shape as today — 2-row or 3-row based on `seasonStatus`).
  7. When `seasonStatus.isLastFireOfSeason` is `true`, the season-finale `section` block goes above the leaderboard table as today.

- **`reveals.length === 0`** (no pending questions): Today's "no verdict to deliver today" acknowledgement, leaderboard still renders.

The prompt SHALL forbid Claude from doing its own per-player counting — it MUST consume `roundSummary.perPlayer` verbatim and use `roundMvp` for the trophy marker, not its own derivation.

The prompt SHALL clarify that the multi-question branch trades the verbose per-voter-bucket layout for brief per-question verdicts + an aggregate round summary, and that this is intentional for readability when N > 1.

#### Scenario: Single-question reveal uses today's layout

- **WHEN** the reveal prompt is inspected
- **THEN** the text describes the length-1 branch as the existing verbose layout (header → why-section → divider → per-bucket sections → context → leaderboard)
- **AND** does NOT instruct Claude to add a separate round-summary section in this branch

#### Scenario: Multi-question reveal includes a Round Summary

- **WHEN** the reveal prompt is inspected
- **THEN** the text describes the length-N branch with: header, brief per-question verdict sections, divider, "Round Summary" section sourced from `roundSummary.perPlayer`, context closer, leaderboard table
- **AND** instructs Claude to keep per-question verdicts to ≤ 2 short sentences each
- **AND** instructs Claude to mark `roundMvp: true` players with `🏆`

#### Scenario: Prompt forbids Claude-side counting

- **WHEN** the reveal prompt is inspected
- **THEN** the text explicitly instructs Claude to read `roundSummary.perPlayer.correct` / `.answered` AS-IS
- **AND** forbids Claude from tallying `reveals[].voters.correct` itself

#### Scenario: Length-0 branch acknowledges with humor

- **WHEN** the reveal prompt is inspected
- **THEN** the text directs Claude to post an in-persona "no verdict today" acknowledgement when `reveals.length === 0`
- **AND** the cumulative leaderboard still renders

## MODIFIED Requirements

### Requirement: Question-posting prompt step flow

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain a payload-driven step flow that opens with the Game Show Presenter persona directive and a "Game: {game}" header, then directs Claude through:

1. **Call `get_ideas(game: "{game}")`** to discover format and get suggestions for slot 0. Read the response's `format` field:
   - If `format` is `null`: follow the **single-question flow** (steps 2–10 below, once).
   - If `format` is an object: follow the **multi-slot flow** — repeat steps 2–8 for each slot index `i` in `[0, format.slotCount)`, then post all items together (steps 9–10).
2. **Read slot context** (multi-slot flow only) — for slot `i > 0`, call `get_ideas(game: "{game}", slot: i)` to get fresh suggestions for this slot. Read `slots[i].label` (creative framing for this slot — e.g. "Lightning Round", "Historical Choice") and `slots[i].categories` (the slot's resolved category pool). Pick one category from the call's `categories.ideas`.
3. **Write a statement with the correct polarity from the start** — branch on `suggestedAnswer`; never write true then flip.
4. **Polarity self-check** — explicitly verify the statement's actual truth matches `suggestedAnswer`; rewrite if not.
5. **Check for duplicates** — Call `find_previous_questions(game: "{game}", text: ...)`. Duplicate detection is **game-scoped, not slot-scoped** — a duplicate match means the question collides with any prior question in this game's history regardless of which slot produced it. Iterate if a match exists.
6. **Validate through research** — confirm the statement is actually true/false.
7. **Difficulty gate** — self-rate 1–10. Easy = 4–6, Medium = 7–8, Hard = 9–10. Reject and regenerate if ≤ 3/10.
8. **Save via `save_question(game: "{game}", category, statement, isTrue, emojis, slot?)`** — when in the multi-slot flow, MUST include `slot: { index: i }`; when in the single-question flow, MUST OMIT the `slot` argument. Retain `questionId` for the post step.
9. **Choose emojis and format using Block Kit `sections`** — 👍 (TRUE) before 👎 (FALSE) for boolean slots; choice slots use the choice-questions reaction set per `trivia-choice-questions`. In the multi-slot flow, the slot's `label` MAY be surfaced as a header inside the slot's block group for player context.
10. **Deliver via `post_questions({ game: "{game}", items: [...] })`** — one item per saved question, in slot order. In the single-question flow, `items` has one entry. After `post_questions` returns, terminate the run with `submit_response({ skip_response: true })`.

The prompt SHALL invite Claude to invent a style each day and include at least one concrete example for inspiration. The prompt SHALL clarify that when `format` is present, `slots[i].label` is a _creative hint_ to Claude for the slot's flavor and is NOT a literal string to copy into the question text.

The prompt SHALL emphasize that pre-roll across slots is forbidden: Claude MUST call `get_ideas(slot: i)` separately for each slot, accepting the fresh `suggestedAnswer` / `suggestedDifficulty` / `suggestedType` returned for that slot.

#### Scenario: Prompt content includes the game header and game-scoped tool calls

- **GIVEN** `buildGameSpecs([{ name: "main", ... }], false)` was called
- **WHEN** the `main:question` spec's `prompt` is inspected
- **THEN** the prompt opens with the persona directive and a `Game: main` header
- **AND** every reference to `get_ideas`, `find_previous_questions`, `save_question`, or `post_questions` passes `game: "main"` as an argument

#### Scenario: Prompt branches on get_ideas's format field

- **WHEN** the prompt content is inspected
- **THEN** the returned text explicitly directs Claude to read `get_ideas`'s `format` response field
- **AND** describes the single-question flow when `format` is `null`
- **AND** describes the multi-slot loop when `format` is an object (one `get_ideas(slot: i)` call per slot)

#### Scenario: Prompt instructs Claude to honor suggestedAnswer

- **WHEN** the prompt content is inspected
- **THEN** the returned text references `suggestedAnswer` from `get_ideas`
- **AND** instructs Claude to keep the statement TRUE when `suggestedAnswer` is `true`, FALSE otherwise
- **AND** does NOT instruct Claude to "randomly decide" the truth value

#### Scenario: Prompt enforces the difficulty gate

- **WHEN** the prompt content is inspected
- **THEN** the returned text contains an explicit rule that questions rated ≤ 3/10 MUST be rejected and regenerated
- **AND** spells out the bucket-to-1–10 mapping (Easy = 4–6, Medium = 7–8, Hard = 9–10)

#### Scenario: Prompt enforces save_question slot arg in multi-slot flow

- **WHEN** the prompt content is inspected
- **THEN** the returned text instructs Claude to pass `slot: { index: i }` to `save_question` when in the multi-slot flow
- **AND** instructs Claude to OMIT the `slot` argument when in the single-question flow

#### Scenario: Prompt forbids pre-rolling suggestions across slots

- **WHEN** the prompt content is inspected
- **THEN** the returned text explicitly forbids reusing slot 0's `suggestedAnswer` for any subsequent slot
- **AND** directs Claude to call `get_ideas(slot: i)` separately for each slot

#### Scenario: Duplicate detection remains game-scoped

- **WHEN** the prompt content is inspected
- **THEN** the returned text instructs Claude that `find_previous_questions` matches across the entire game's history regardless of slot
- **AND** does NOT instruct Claude to filter `find_previous_questions` results by slot

### Requirement: requiredTools per spec

Each game's question spec SHALL have `requiredTools` equal to:

```
["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question", "mcp__trivia__post_questions"]
```

Each game's reveal spec SHALL have `requiredTools` equal to:

```
["mcp__trivia__process_reveal_answers"]
```

The reveal `requiredTools` list SHALL be the SAME regardless of `trivia.seasons.enabled` or whether the active season has a `format`. The question `requiredTools` list SHALL ALSO be the SAME regardless of `format` — `post_questions` is required for both single-question and multi-slot flows so cron specs stay stable across format changes.

#### Scenario: Question spec requiredTools includes post_questions

- **WHEN** `buildGameSpecs` produces a `<name>:question` spec
- **THEN** the spec's `requiredTools` includes `mcp__trivia__get_ideas`, `mcp__trivia__find_previous_questions`, `mcp__trivia__save_question`, and `mcp__trivia__post_questions`

#### Scenario: Question spec requiredTools is stable across format presence

- **GIVEN** two games — one whose active season has a `format`, one whose does not
- **WHEN** `buildGameSpecs(games, ...)` is called
- **THEN** both games' `<name>:question` specs have byte-identical `requiredTools` lists

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

### Requirement: buildGameSpecs does not peek into seasons state

`buildGameSpecs` SHALL NOT read any per-game `seasons.json` file when generating cron specs. Spec generation SHALL be a pure function of `config.trivia.games[]` (and the global `trivia.seasons.enabled` flag, for the optional behavior described in `trivia-seasons`).

Format-driven branching SHALL happen ENTIRELY at run time, inside `get_ideas`'s payload and the prompt's interpretation of that payload. Mutating a season's `format` via `upsert_season` SHALL NOT require any cron-spec reconcile — the change is visible on the next question-cron fire.

#### Scenario: buildGameSpecs output is independent of seasons.json content

- **GIVEN** two test runs of `buildGameSpecs` with identical `config.trivia.games[]` but different `games/<game>/seasons.json` contents (one with a multi-slot format, one with no format)
- **WHEN** the two outputs are compared
- **THEN** the resulting cron-spec arrays are byte-identical

#### Scenario: Format mutation does not require cron reconcile

- **GIVEN** an admin updates a season's `format` via `upsert_season`
- **WHEN** the next question cron for that game fires
- **THEN** the run loads the new format from `get_ideas` and posts accordingly
- **AND** `sdk.reconcileCronJobs` is not called as a side effect of the format change
