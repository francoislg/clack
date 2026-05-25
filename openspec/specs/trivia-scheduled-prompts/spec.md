# trivia-scheduled-prompts Specification

## Purpose

The trivia plugin generates its scheduled-run prompts (question posting, answer reveal) inline as TypeScript constants in `src/plugins/trivia/scheduledPrompts.ts`. The plugin's `buildGameSpecs()` substitutes a `{game}` placeholder per cron spec at plugin load and hands the resulting `CronJobSpec[]` to `sdk.reconcileCronJobs("trivia", ...)`. There are no on-demand "fetch the prompt" MCP tools — admins create games by editing `config.trivia.games[]` and the plugin reconciles automatically. A blocking migration upgrades legacy dispatcher-style cron jobs into the declarative model.

## Requirements

### Requirement: Schedule Prompts Are Thin Dispatchers

Cron jobs reconciled by `sdk.reconcileCronJobs("trivia", specs)` from `config.trivia.games[]` SHALL carry full prompts inlined by `buildGameSpecs()`. Each spec's `prompt` SHALL embed the game's `name` at the top (`"Game: <name>. ..."`) and pass `game: "<name>"` literally to every trivia tool call referenced in the prompt's step sequence.

The prompt text itself SHALL come from constants in `src/plugins/trivia/scheduledPrompts.ts`:

- `SEND_QUESTIONS_INSTRUCTIONS` for the question-posting spec (`<name>:question`). Unchanged: this prompt remains the substantive Claude-driven flow for generating, validating, and posting a new question.
- `PROCESS_REVEAL_INSTRUCTIONS` for the reveal spec (`<name>:reveal`). This is a **renderer brief**, not a step-by-step orchestration prompt. It SHALL direct Claude to perform exactly two actions: (a) call `process_reveal_answers(game: "<name>")` and read its returned payload, then (b) render the payload as a Slack reveal using the Game Show Presenter persona via `submit_response`.

Each constant SHALL contain a `{game}` placeholder (used at every tool-call step that takes a `game` arg, plus a header line). `buildGameSpecs()` SHALL substitute `{game}` with the spec's `name` before assigning to `CronJobSpec.prompt`.

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

### Requirement: Question-posting prompt step flow

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain a numbered step flow that opens with the Game Show Presenter persona directive and a "Game: {game}" header, then directs Claude through:

1. **Get category ideas and suggestions** — Call `get_ideas(game: "{game}")`. Read `suggestedAnswer` and `suggestedDifficulty`. Pick one category from `categories.ideas`.
2. **Write a statement with the correct polarity from the start** — branch on `suggestedAnswer`; never write true then flip.
3. **Polarity self-check** — explicitly verify the statement's actual truth matches `suggestedAnswer`; rewrite if not.
4. **Check for duplicates** — Call `find_previous_questions(game: "{game}", text: ...)`; iterate if a match exists in this game's history.
5. **Validate through research** — confirm the statement is actually true/false.
6. **Difficulty gate (strict membership + one-shot reframe)** — self-rate 1–10. The bucket's `suggestedDifficultyRange` `[min, max]` from `get_ideas` IS the strict accept bound (no separate threshold). Rating inside `[min, max]` → proceed. Rating EXACTLY `min - 1` or `max + 1` (one point off) → REFRAME ONCE: rewrite the question to dial difficulty toward the range, then re-rate independently; for boolean flows, re-run the polarity self-check on the reframed statement before re-rating. If v2 lies inside the range → proceed; if v2 still outside → REJECT and re-call `get_ideas`. Rating two or more points outside `[min, max]` → REJECT immediately and re-call `get_ideas` (don't reframe — the topic is wrong, not the framing).
7. **Choose emojis** relating to the topic.
8. **Save via `save_question(game: "{game}", category, statement, isTrue, emojis)`** — retain `questionId`.
9. **Format using Block Kit** — build the question card blocks (header / warm-up section / card / closer context for boolean; header / section / card with numbered choice layout / context for choice). For boolean questions, the card body SHALL include "👍 TRUE • 👎 FALSE" with 👍 listed before 👎. For choice questions, the numbered-emoji prefix (1️⃣ … 4️⃣) in the card body SHALL match the stored `choices` array order so the bot's automatic reactions align with each option's index.
10. **Post via `post_questions(game: "{game}", items: [{ questionId, blocks }])`** — the tool resolves the channel from game config and derives the reactions from the stored question's type, so the prompt does NOT instruct Claude to specify a channel or a `reactions` list. When the call returns one or more `results[].ok === false` entries, make a follow-up `post_questions` call carrying only the failed items AND pass `appendToPreviousBatch: true` so the retried items share the original batch's `batchId` and reveal together with the original successes.
11. **Terminate via `submit_response({ skip_response: true })`** — no user-facing reply is needed; the run's deliverable is the `post_questions` result.

The prompt SHALL invite Claude to invent a style each day and include at least one concrete example for inspiration.

The prompt SHALL NOT instruct Claude to pass `reactions: [...]` to any tool. Reactions are derived inside `post_questions` and SHALL NOT appear in the prompt's tool-call instructions.

#### Scenario: Prompt content includes the game header and game-scoped tool calls

- **GIVEN** `buildGameSpecs([{ name: "main", ... }], false)` was called
- **WHEN** the `main:question` spec's `prompt` is inspected
- **THEN** the prompt opens with the persona directive and a `Game: main` header
- **AND** every reference to `get_ideas`, `find_previous_questions`, `save_question`, or `post_questions` passes `game: "main"` as an argument

#### Scenario: Prompt instructs Claude to honor suggestedAnswer

- **WHEN** the prompt content is inspected
- **THEN** the returned text references `suggestedAnswer` from `get_ideas`
- **AND** instructs Claude to keep the statement TRUE when `suggestedAnswer` is `true`, FALSE otherwise
- **AND** does NOT instruct Claude to "randomly decide" the truth value

#### Scenario: Prompt enforces strict-membership difficulty gate

- **WHEN** the prompt content is inspected
- **THEN** the returned text instructs Claude to self-rate on the 1–10 scale and accept ONLY when the rating lies inside `suggestedDifficultyRange` `[min, max]`
- **AND** instructs Claude to REFRAME ONCE when the rating is exactly one point outside the range (min − 1 or max + 1) and to re-rate independently
- **AND** instructs Claude to REJECT and re-roll `get_ideas` when the rating is two or more points outside the range, or when a reframed version still lies outside the range
- **AND** does NOT contain the legacy "reject ≤ 3/10" rule
- **AND** does NOT reference `minimumDifficultyThreshold`
- **AND** does NOT enumerate a fixed bucket→1–10 mapping (Easy/Medium/Hard ranges are surfaced via `suggestedDifficultyRange`, not hardcoded in the prompt)

#### Scenario: Reframe step re-runs polarity self-check for boolean questions

- **WHEN** the BOOLEAN_FACT or BOOLEAN_TOPICAL flow's reframe step is inspected
- **THEN** the prompt instructs Claude to re-run the polarity self-check on the reframed statement before continuing to the difficulty re-rating
- **AND** explains that reframing-by-detail-swap can silently flip a statement's truth value

#### Scenario: Prompt routes posting through post_questions

- **WHEN** the prompt content is inspected
- **THEN** the returned text instructs Claude to call `post_questions(game: "{game}", items: [{ questionId, blocks }])` after `save_question`
- **AND** does NOT instruct Claude to call `submit_response` with `reactions` to deliver the question
- **AND** does NOT instruct Claude to pass a `channel` or a `reactions` field to `post_questions`

#### Scenario: Prompt terminates with skip_response

- **WHEN** the prompt content is inspected
- **THEN** the returned text instructs Claude to call `submit_response({ skip_response: true })` after `post_questions`
- **AND** does NOT instruct Claude to render a user-facing reply for the question-posting run

#### Scenario: Card body lists 👍 before 👎 for boolean questions

- **WHEN** the prompt content is inspected
- **THEN** the returned text instructs Claude to put 👍 (TRUE) before 👎 (FALSE) in the boolean question card body
- **AND** notes that the bot's automatic reactions match this order

#### Scenario: Numbered-emoji prefix order matches stored choices order

- **WHEN** the prompt content is inspected for the choice path
- **THEN** the returned text instructs Claude to prefix each choice with 1️⃣ / 2️⃣ / 3️⃣ / 4️⃣ in the same order as the stored `choices` array
- **AND** explains that the bot's automatic numeric reactions align to those indices

### Requirement: Six-Way Generation Matrix

The scheduled question-posting prompt SHALL dispatch on the cross product of `suggestedAnswersFormat × suggestedQuestionType`, where `suggestedAnswersFormat ∈ { "boolean", "choice", "freeform" }` and `suggestedQuestionType ∈ { "fact", "topical" }`, producing six explicit generation paths:

```
              boolean             choice              freeform
fact     │ BOOLEAN_FACT      │ CHOICE_FACT       │ FREEFORM_FACT       │
topical  │ BOOLEAN_TOPICAL   │ CHOICE_TOPICAL    │ FREEFORM_TOPICAL    │
```

The two freeform paths (`FREEFORM_FACT_FLOW_STEPS`, `FREEFORM_TOPICAL_FLOW_STEPS`) SHALL instruct Claude to:

1. Write the question's `statement` in the same plain-statement style as boolean/choice paths.
2. Write the canonical `expectedAnswer: string` — the shortest correct form Claude would accept as a 100%-perfect answer.
3. OPTIONALLY enumerate `acceptableAnswers: string[]` — semantic variants and reasonable rephrasings Claude would also accept (e.g. canonical-plus-common-forms).
4. OPTIONALLY add `gradingNotes: string` — a one-sentence hint to the reveal-time judge about acceptable answer forms or specific judging considerations.
5. Call `save_question` with `answersFormat: "freeform"` plus the fields above (and the existing common fields: `questionType`, `category`, `emojis`, etc.).

The `FREEFORM_TOPICAL_FLOW_STEPS` path SHALL additionally run the same WebSearch research step and `sourceUrl` capture as the existing `BOOLEAN_TOPICAL` and `CHOICE_TOPICAL` paths — descending through `contextPriority` the same way.

#### Scenario: Fact-freeform dispatch

- **WHEN** `get_ideas` rolls `suggestedAnswersFormat: "freeform"` and `suggestedQuestionType: "fact"`
- **THEN** the scheduled prompt routes to `FREEFORM_FACT_FLOW_STEPS`
- **AND** the path does NOT invoke `WebSearch`
- **AND** the path's `save_question` instruction passes `answersFormat: "freeform"`

#### Scenario: Topical-freeform dispatch

- **WHEN** `get_ideas` rolls `suggestedAnswersFormat: "freeform"` and `suggestedQuestionType: "topical"`
- **THEN** the scheduled prompt routes to `FREEFORM_TOPICAL_FLOW_STEPS`
- **AND** the path runs the same WebSearch research step + `contextPriority` descent as other topical paths
- **AND** the saved question carries `sourceUrl` (required), optional `eventDate`, and the freeform fields (`expectedAnswer`, optionally `acceptableAnswers` / `gradingNotes`)

#### Scenario: Non-freeform dispatch unchanged

- **WHEN** `get_ideas` rolls `suggestedAnswersFormat: "boolean"` or `"choice"`
- **THEN** the dispatch chooses the existing `BOOLEAN_*` or `CHOICE_*` path as before
- **AND** no freeform-specific instruction is included in the prompt

### Requirement: Question-posting prompt renders a new-season opener on first fire

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain an opener branch that fires at the top of the question-cron flow whenever the `get_ideas` response carries `firstFireOfSeason: true`. The branch SHALL instruct Claude to prepend, ABOVE the normal question content blocks, exactly two ceremonial Block Kit blocks:

1. A `header` block whose text begins with a literal `"🆕 NEW SEASON"` prefix (Unicode characters, NOT `:new:` shortcode). Claude MAY append the season slug or theme to that prefix in a short flourish (e.g. `"🆕 NEW SEASON: HALLOWEEN SPOOKTACULAR"`).
2. A `section` block of in-persona prose that (a) names the current season's slug, (b) when AND ONLY WHEN the `get_ideas` response includes a non-empty `theme` field, mentions the theme verbatim in one short line. When `theme` is absent, the section MUST NOT mention any theme, MUST NOT speculate about one, and MUST NOT enumerate the season's categories as a stand-in.

The branch SHALL be silent (no opener blocks rendered) when `firstFireOfSeason` is `false`. The branch SHALL apply to BOTH outer flows (single-question and multi-slot): the two ceremonial blocks live above the entire question-content payload regardless of how many slots follow.

The branch SHALL NOT introduce any new tool calls; it consumes data that `get_ideas` already returns on its existing invocation. The branch SHALL NOT call `submit_response` differently — termination remains `submit_response({ skip_response: true })` after `post_questions`.

The opener SHALL fire on the FIRST question-cron fire of any season that has no saved questions stamped to it — independent of whether that season was created by `applySeasonRollover` (auto-continuation), pre-staged by an admin via `upsert_season`, or seeded as the starter season on a freshly-bootstrapped game. The detection is purely a function of `firstFireOfSeason` in the `get_ideas` payload, never any persisted "announced" flag.

#### Scenario: Opener branch present in question-posting prompt

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the returned text references `firstFireOfSeason`
- **AND** instructs Claude to render a `header` block + `section` block above the question content when that flag is `true`
- **AND** the header block's text contains the literal Unicode characters `🆕`
- **AND** the prompt explicitly tells Claude NOT to render the opener blocks when `firstFireOfSeason` is `false`

#### Scenario: Opener mentions theme conditionally

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the prompt instructs Claude to mention the `theme` field from `get_ideas` in the opener section block ONLY when that field is present
- **AND** the prompt explicitly tells Claude NOT to fabricate a theme, NOT to enumerate categories as a substitute, and NOT to say "this season has no theme" when `theme` is absent

#### Scenario: Opener applies to both single-question and multi-slot flows

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the opener branch is positioned (or worded) so it applies uniformly whether the question-cron fire produces one question or multiple slot questions
- **AND** the opener blocks sit ABOVE the entire question-content payload — not interleaved between slots and not duplicated per slot

#### Scenario: Opener fires regardless of how the season originated

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the prompt's opener branch is unconditional on the origin of the current season — it does not distinguish between rollover-auto-continuation, admin-prestaged, or lazy-bootstrap starter seasons
- **AND** the only signal it consumes is `firstFireOfSeason` from `get_ideas`

#### Scenario: Opener does NOT introduce new tool calls

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the opener branch does NOT instruct Claude to call any tool beyond the existing question-posting tool set (`get_ideas`, `find_previous_questions`, `save_question`, `post_questions`, `submit_response`)
- **AND** the run still terminates with `submit_response({ skip_response: true })`

### Requirement: Question-posting prompt instructs retry-with-appendToPreviousBatch

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain an explicit retry clause attached to the `post_questions` step (step 10). The clause SHALL tell Claude that when a `post_questions` call returns one or more `results[].ok === false` entries, Claude SHALL make a follow-up `post_questions` call carrying only the failed items AND pass `appendToPreviousBatch: true` so the retried items share the original batch's `batchId` and reveal together with the original successes.

The clause SHALL name the flag (`appendToPreviousBatch`) literally and SHALL state the value (`true`) literally so the prompt is unambiguous.

The clause SHALL NOT instruct Claude to extract a `batchId` value from the prior response and pass it as a string. The batch-identifier handling is internal to the tool; Claude only flips the boolean.

The clause SHALL apply to BOTH outer flows (single-question and multi-slot). In the single-question flow it covers the rare case of one item failing in isolation; in the multi-slot flow it covers the common case of one slot's blocks being rejected while sibling slots post successfully.

#### Scenario: Prompt names appendToPreviousBatch in the retry clause

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the returned text contains the literal string `appendToPreviousBatch`
- **AND** contains the literal value `true` in proximity to that flag name (e.g. `appendToPreviousBatch: true`)
- **AND** explicitly ties the flag to the retry-of-failed-items scenario (not to brand-new batches)

#### Scenario: Prompt does NOT instruct Claude to thread a raw batchId string

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the returned text does NOT instruct Claude to read a `batchId` value out of the prior tool result and pass it as a `batchId: "..."` argument to `post_questions`
- **AND** does NOT contain instructions equivalent to "pass the previous call's batchId on retry"

#### Scenario: Prompt covers both single-question and multi-slot retry paths

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the retry clause is positioned so it applies regardless of whether the outer flow is single-question or multi-slot (e.g. it lives in the shared step 10 / "POST" section, not nested inside the multi-slot branch alone)

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
[
  "mcp__trivia__get_ideas",
  "mcp__trivia__find_previous_questions",
  "mcp__trivia__save_question",
  "mcp__trivia__post_questions"
]
```

Each game's reveal spec SHALL have `requiredTools` equal to:

```
["mcp__trivia__process_reveal_answers"]
```

The reveal `requiredTools` list SHALL be the SAME regardless of `trivia.seasons.enabled`. Seasons-specific behavior is handled inside `process_reveal_answers`; the spec's required-tools list SHALL NOT vary with that flag.

#### Scenario: Question spec requiredTools includes post_questions

- **WHEN** `buildGameSpecs` produces a `<name>:question` spec
- **THEN** the spec's `requiredTools` includes (at minimum) `mcp__trivia__get_ideas`, `mcp__trivia__find_previous_questions`, `mcp__trivia__save_question`, and `mcp__trivia__post_questions`
- **AND** the order of entries does NOT affect correctness

#### Scenario: Reveal spec requiredTools is a single-element list

- **GIVEN** `buildGameSpecs(games, seasonsEnabled: false)` is called
- **WHEN** the resulting `<name>:reveal` spec is inspected
- **THEN** `requiredTools` equals `["mcp__trivia__process_reveal_answers"]`
- **AND** does NOT include `mcp__clack__fetch_channel_messages`, `mcp__trivia__find_previous_questions`, `mcp__trivia__get_question_history`, `mcp__trivia__submit_answers`, `mcp__trivia__retrieve_scores`, `mcp__trivia__check_season_status`, or `mcp__trivia__post_questions`

#### Scenario: Reveal spec requiredTools is identical when seasons are enabled

- **GIVEN** `buildGameSpecs(games, seasonsEnabled: true)` is called
- **WHEN** the resulting `<name>:reveal` spec is inspected
- **THEN** `requiredTools` equals `["mcp__trivia__process_reveal_answers"]`
- **AND** the list is byte-identical to the seasons-disabled case

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

### Requirement: Misconfigured reveal-before-question warning

When `buildGameSpecs` is called, for each game whose `revealCron` would fire before `questionCron` on the next matching date in the game's timezone, the plugin SHALL emit a logger warning naming the game and both cron expressions. The specs SHALL still be returned (no rejection at build time) — the warning surfaces likely misconfigurations without blocking startup.

#### Scenario: Reveal-before-question is warned but not blocked

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", questionCron: "0 17 * * *", revealCron: "0 9 * * *", ... }` (reveal at 9am, question at 5pm)
- **WHEN** `buildGameSpecs([main], ...)` is called
- **THEN** the function returns both `main:question` and `main:reveal` specs (no rejection)
- **AND** a warning is logged identifying `main` and both cron expressions

### Requirement: Legacy Trivia Cron Migration

A blocking migration SHALL run at boot to convert pre-existing dispatcher-style trivia cron jobs into `config.trivia.games[]` entries and delete them from `cron-jobs.json`. The migration SHALL be idempotent and safe to run multiple times.

A cron job is considered a candidate iff `plugin === "trivia"` AND `prompt` matches one of the known dispatcher patterns (`"Call send_questions_instructions and follow"` or `"Call process_responses_instructions and follow"`).

For each pair of candidates sharing the same `channel` (one question + one reveal), the migration SHALL:

1. Derive a `name` (e.g., `"legacy-<channel>"`, lowercased).
2. Append a `TriviaGame` entry to `config.trivia.games[]` with `channel`, `questionCron`, `revealCron`, and `timezone`.
3. Delete both source jobs from `cron-jobs.json`.

The same migration ALSO moves any legacy flat-file trivia data (`data/plugins/trivia/{questions,answers,cheats,seasons}.json`) into a per-game directory under `data/plugins/trivia/games/<target>/`. The target is selected in this order: first newly-created `legacy-<channel>` from this run, else first pre-existing `config.trivia.games[]` entry, else a fallback `initialgame` entry with placeholder crons and `enabled: false`. See the `trivia-games` capability for the full data-move contract.

Inline fat-prompt legacy cron jobs (whose `prompt` does NOT match a dispatcher pattern) SHALL be left untouched by the migration. Such jobs, on first scheduled fire post-upgrade, will fail at the first `mcp__trivia__*` tool call because the tool now requires a `game` argument the inline prompt does not pass. Operators SHALL delete and re-create these jobs by adding entries to `config.trivia.games[]`.

#### Scenario: Dispatcher pair migrates cleanly

- **GIVEN** two cron jobs in channel `C123` with `plugin === "trivia"`, one having `prompt` matching the question dispatcher and `cronExpression: "0 9 * * 1-5"`, the other matching the reveal dispatcher with `cronExpression: "0 15 * * 1-5"`
- **WHEN** the migration runs
- **THEN** `config.trivia.games[]` gains an entry matching `{ name: "legacy-c123", channel: "C123", questionCron: "0 9 * * 1-5", revealCron: "0 15 * * 1-5", timezone: <inherited> }`
- **AND** both source jobs are removed from `cron-jobs.json`

#### Scenario: Inline fat-prompt legacy job is left in place

- **GIVEN** a cron job with `plugin === "trivia"` whose `prompt` is a heavily customized multi-line text (not a known dispatcher pattern)
- **WHEN** the migration runs
- **THEN** the job is NOT migrated
- **AND** the job persists in `cron-jobs.json`
- **AND** on its next scheduled fire, the first `mcp__trivia__*` tool call returns a "missing game argument" Zod error
- **AND** the run aborts without writing any per-game data

#### Scenario: Migration is idempotent

- **GIVEN** the migration has run once and converted all candidates
- **WHEN** the migration runs again on the next boot
- **THEN** no candidates are found
- **AND** the migration is a no-op (no writes to either file)

#### Scenario: Unpaired candidate is flagged

- **GIVEN** a single dispatcher-style job in channel `C123` with no matching pair (only a question, no reveal — or vice versa)
- **WHEN** the migration runs
- **THEN** the job is NOT migrated (a `TriviaGame` requires both question and reveal crons)
- **AND** the job continues to fire
