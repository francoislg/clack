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
4. **Check for duplicates** — Call `find_previous_questions({ keywords: [3-5 distinctive terms from the statement], match: "any" })`. The call SHALL OMIT the `games` argument so the scan spans every game (duplicate facts in sibling games still count as duplicates). The keyword list SHALL be 3 to 5 distinctive terms — names, numbers, rare nouns — chosen so a duplicate fact in any framing would surface. For each returned row, inspect its `matchedKeywords` and `statement` to decide whether the row covers the same underlying fact in any framing or polarity; if any candidate is a duplicate, return to step 2 and write a different statement. If the result set is uninformatively wide (many rows matching only on common words), re-call with sharper keywords.
5. **Validate through research** — confirm the statement is actually true/false.
6. **Difficulty gate (strict membership + one-shot reframe)** — self-rate 1–10. The bucket's `suggestedDifficultyRange` `[min, max]` from `get_ideas` IS the strict accept bound (no separate threshold). Rating inside `[min, max]` → proceed. Rating EXACTLY `min - 1` or `max + 1` (one point off) → REFRAME ONCE; for boolean flows, re-run the polarity self-check on the reframed statement before re-rating. If v2 lies inside the range → proceed; if v2 still outside → REJECT and re-call `get_ideas`. Rating two or more points outside `[min, max]` → REJECT immediately and re-call `get_ideas`.
7. **Choose emojis** relating to the topic.
8. **Save via `save_question(game: "{game}", category, statement, isTrue, emojis)`** — retain `questionId`.
9. **Format using Block Kit — FOUR-BLOCK + actions layout** — build the question card blocks. The layout is:
   - `header` — show banner (slot-0 of multi-slot uses a calmer date-stamped round opener).
   - `section` — warm-up patter (topical-flag-required for `questionType: "topical"`).
   - `card` — title `{ <emoji> <Category> }`, optional `subtitle: "Current News"` for topical, body `{ <statement> }`.
   - `context` — closer line nudging users to vote.

   The prompt SHALL NOT instruct Claude to include an inline "answer options" text block (the legacy block #4). Affordances live entirely in the appended `actions` block that `post_questions` adds automatically. For boolean: `👍 TRUE` and `👎 FALSE` buttons. For choice: `1️⃣ <choice0>` … `4️⃣ <choiceN>` buttons. For freeform: an `Answer` button.

   The prompt SHALL warn Claude to keep choice text reasonably concise so the button labels (75-char cap) render readably; the card body always carries the full statement when truncation occurs.

10. **Post via `post_questions(game: "{game}", items: [{ questionId, blocks }])`** — the tool resolves the channel from game config, appends the answer-buttons actions block automatically (sized to the question's `answersFormat`), and stamps `liveAnswersVisible` on the question record. The prompt SHALL NOT instruct Claude to specify a channel, a `reactions` list, or to add buttons manually. When the call returns one or more `results[].ok === false` entries, make a follow-up `post_questions` call carrying only the failed items AND pass `appendToPreviousBatch: true` so the retried items share the original batch's `batchId` and reveal together with the original successes.
11. **Terminate via `submit_response({ skip_response: true })`** — no user-facing reply is needed.

The prompt SHALL invite Claude to invent a style each day and include at least one concrete example for inspiration.

The prompt SHALL NOT instruct Claude to pass `reactions: [...]` to any tool. Reactions are no longer auto-attached.

The prompt SHALL NOT instruct Claude to render the legacy block #4 ("👍 TRUE • 👎 FALSE" inline text, or "1️⃣ Beatles · 2️⃣ Zeppelin · …" inline choice text). Those are replaced by the appended `actions` block.

#### Scenario: Prompt content includes the game header and game-scoped tool calls except for duplicate detection

- **GIVEN** `buildGameSpecs([{ name: "main", ... }], false)` was called
- **WHEN** the `main:question` spec's `prompt` is inspected
- **THEN** the prompt opens with the persona directive and a `Game: main` header
- **AND** every reference to `get_ideas`, `save_question`, or `post_questions` passes `game: "main"` as an argument
- **AND** the duplicate-detection step (step 4) calls `find_previous_questions` WITHOUT a `games` argument
- **AND** the duplicate-detection step explicitly passes `match: "any"` and a `keywords: [...]` array

#### Scenario: Prompt removes the game-scoped carve-out for duplicate detection

- **WHEN** the prompt content is inspected
- **THEN** the prompt does NOT contain wording asserting that duplicate detection is "GAME-SCOPED" or "stays game-scoped"
- **AND** does NOT instruct Claude to pass a `game` or `games` argument when calling `find_previous_questions` for duplicate detection

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

#### Scenario: Prompt describes FOUR-BLOCK + actions layout

- **WHEN** the prompt's question-card section is inspected
- **THEN** the returned text describes a FOUR-block question card (header / patter / card / closer)
- **AND** does NOT instruct Claude to add a fifth "answer options" inline text section between the card and the closer
- **AND** does NOT instruct Claude to write "👍 TRUE • 👎 FALSE" as an inline text block
- **AND** does NOT instruct Claude to write a "1️⃣ <choice> · 2️⃣ <choice> · …" inline choice list block
- **AND** explains that `post_questions` automatically appends an `actions` block carrying the answer buttons for all three formats

#### Scenario: Prompt warns about button-label truncation on long choice text

- **WHEN** the prompt's choice path is inspected
- **THEN** the returned text notes that Slack truncates button labels around 75 characters and instructs Claude to keep choice text concise
- **AND** notes that the card body carries the full statement so any visual truncation in buttons does not cause information loss

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

1. **Call `process_reveal_answers(game: "{game}")`** and read its returned payload. The prompt SHALL describe the payload's shape (the `reveals[]`, `leaderboard`, optional `roundSummary`, and optional `seasonStatus` fields) so Claude can render it without inventing structure. The prompt SHALL describe each reveal entry's `voters` as a discriminated union on `voters.revealResponses` with three variants:
   - `"yes"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters in `correct[]` and `incorrect[]` carry an `answerText` field that SHOULD be quoted in the reveal.
   - `"just-correctness"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters DO NOT carry `answerText`. The prompt SHALL instruct Claude to enumerate the named voters (e.g. "Marc and Sarah nailed it; Bob missed it") but SHALL NOT quote any typed freeform text — and SHALL note that the text is not in the payload to quote.
   - `"no"` → `voters` carries ONLY `reactions`. The `correct`, `incorrect`, and `noAnswer` fields are physically absent. The prompt SHALL instruct Claude to render the answer plus reactions commentary plus the leaderboard, and NOT to invent or speculate about who voted what.

   The prompt SHALL describe `voters.reactions` as carrying every reactor's FULL emoji set, with bot + cheaters already excluded. The prompt SHALL describe `roundSummary` as OPTIONAL — present only when every reveal entry in the batch has `revealResponses === "yes"`.

2. **Render the payload via `submit_response`** using the Game Show Presenter voice and Block Kit conventions:
   - A `header` block announcing the verdict (e.g. "🎯 THE ANSWER IS TRUE!", "🎲 IT'S FALSE!", or the equivalent for choice; for freeform, the canonical `expectedAnswer`).
   - A `section` block explaining WHY using the question's facts.
   - A `divider` block.
   - For `revealResponses === "yes"`: one `section` block per non-empty voter situation: `correct`, `incorrect`, `noAnswer`. Empty situations SHALL be omitted. Quote freeform `answerText` inline when present.
   - For `revealResponses === "just-correctness"`: one `section` block per non-empty voter situation: `correct`, `incorrect`, `noAnswer`. Empty situations SHALL be omitted. Enumerate named voters WITHOUT quoting any freeform text.
   - For `revealResponses === "no"`: NO voter-situation sections. Skip directly to the reactions / closer / leaderboard.
   - A `section` block for `reactions` commentary — Claude SHALL freely riff on each reactor's emoji set, treating reactions as pure flavor. For `"yes"` and `"just-correctness"` modes, Claude MAY join on `userId` to correlate reactions with each user's answer when interesting (e.g. "Marc clutched the right answer AND dropped a 🎯"). For `"no"` mode, Claude SHALL NOT correlate reactions with answers (the per-user answer data is not in the payload).
   - A `context` block as a closer that introduces the leaderboard.
   - A top-level `table` parameter rendering the leaderboard.

The prompt SHALL explicitly state that scoring is NOT derived from Slack reactions — the `correct` / `incorrect` buckets are the source of truth (when present) and reactions are commentary only. The prompt SHALL NOT instruct Claude to interpret reactions as votes, classify "fence-sitters" by counting `:+1:` + `:-1:`, or void "multi-react voters" on choice questions.

The prompt SHALL explicitly state that Claude SHALL NOT invent or speculate about per-user participation when the `voters` variant does not include those buckets (`"no"` mode) — the payload boundary is the gate.

#### Scenario: Reveal prompt describes the discriminated voter shape

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the text describes `voters.revealResponses` as the discriminator and enumerates all three variants (`"yes"`, `"just-correctness"`, `"no"`)
- **AND** the `"yes"` variant description mentions `correct`, `incorrect`, `noAnswer`, `reactions` AND freeform `answerText` quoting
- **AND** the `"just-correctness"` variant description mentions `correct`, `incorrect`, `noAnswer`, `reactions` AND explicitly states freeform text MUST NOT be quoted (and is not in the payload)
- **AND** the `"no"` variant description states ONLY `reactions` is present and instructs Claude not to speculate about per-user participation
- **AND** does NOT mention `voters.fenceSitters` or `voters.wildcards`
- **AND** does NOT describe a "user reacted with both 👍 and 👎" fence-sitter classification
- **AND** does NOT describe a "multi-react void" rule

#### Scenario: Reveal prompt branches block rendering on revealResponses

- **WHEN** the prompt's per-mode rendering instructions are inspected
- **THEN** the `"yes"` branch describes per-bucket sections WITH freeform quotes
- **AND** the `"just-correctness"` branch describes per-bucket sections WITHOUT freeform quotes
- **AND** the `"no"` branch describes NO per-bucket sections, only reactions + closer + leaderboard

#### Scenario: Reveal prompt describes roundSummary as optional

- **WHEN** the prompt's payload-shape description is inspected
- **THEN** `roundSummary` is described as OPTIONAL and present only when every reveal entry in the batch has `revealResponses === "yes"`

#### Scenario: Reveal prompt treats reactions as commentary

- **WHEN** the prompt's reactions section is inspected
- **THEN** the text instructs Claude to riff on per-user emoji sets purely for flavor
- **AND** explicitly states that reactions do not affect scoring
- **AND** invites Claude to correlate reactions with the same user's answer when there is something funny to say (correct + 🎯, incorrect + 🤔, no-answer + 🐢, etc.)

#### Scenario: Reveal prompt omits submit_answers

- **WHEN** the prompt is inspected
- **THEN** the text does NOT reference a `submit_answers` tool call
- **AND** the only deterministic-work tool referenced is `process_reveal_answers`

### Requirement: requiredTools per spec

The `buildGameSpecs` function SHALL emit `requiredTools` for each cron spec:

- For `<game>:question` (question-posting), `requiredTools: ["mcp__trivia__post_questions", "mcp__trivia__save_question", "mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions"]`.
- For `<game>:reveal` (reveal), `requiredTools: ["mcp__trivia__process_reveal_answers"]`. The `mcp__trivia__submit_answers` tool SHALL NOT appear (it is removed).

#### Scenario: Question-posting spec requires post_questions

- **WHEN** `buildGameSpecs` produces the `main:question` spec
- **THEN** `requiredTools` includes `"mcp__trivia__post_questions"`

#### Scenario: Reveal spec requires process_reveal_answers and not submit_answers

- **WHEN** `buildGameSpecs` produces the `main:reveal` spec
- **THEN** `requiredTools` includes `"mcp__trivia__process_reveal_answers"`
- **AND** `requiredTools` does NOT include `"mcp__trivia__submit_answers"`

### Requirement: Reveal prompt branches on reveals.length

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL explicitly branch on `reveals.length`:

- `reveals.length === 0`: render an empty-payload acknowledgement plus the cumulative leaderboard table.
- `reveals.length === 1`: SINGLE-QUESTION layout — full per-voter-bucket sections (`correct`, `incorrect`, `noAnswer`) plus reactions commentary plus the leaderboard. The `roundSummary` field is IGNORED.
- `reveals.length > 1`: MULTI-QUESTION layout — brief per-question verdicts plus a "Round Summary" section sourced from `roundSummary.perPlayer`. Trades verbose voter-bucket sections for an aggregate scoreboard. The cumulative leaderboard table SHALL ALSO carry a `This Round` row above `Current Season` / `All Time` whenever `roundSummary` is present in the payload (see "Reveal table renders This Round row in multi-question batches").

#### Scenario: Single-question branch describes the new voter buckets

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the returned text describes rendering `correct`, `incorrect`, and `noAnswer` sections (when present per the `revealResponses` mode)
- **AND** does NOT reference `fenceSitters` or `wildcards`
- **AND** describes the per-mode rendering branches for `"yes"`, `"just-correctness"`, and `"no"`

#### Scenario: Empty-reveals branch unchanged

- **WHEN** the prompt's empty-reveals branch is inspected
- **THEN** the behavior is unchanged from prior to this proposal — render the acknowledgement plus the cumulative leaderboard

#### Scenario: Single-question layout omits This Round row

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the prompt does NOT instruct Claude to render a `This Round` leaderboard row in that branch
- **AND** the existing 3-row dual-totals shape and 2-row no-label shape remain the only two table shapes referenced by the single-question branch

### Requirement: Reveal table renders This Round row in multi-question batches

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe a `This Round` leaderboard-table row that is rendered ABOVE the `Current Season` / `All Time` rows whenever BOTH conditions hold: (a) `reveals.length > 1`, AND (b) the `roundSummary` field is present in the `process_reveal_answers` payload. When either condition fails, the row SHALL be omitted and the existing table shapes ship unchanged.

The row SHALL be sourced from `roundSummary.perPlayer`, using the SAME player columns as the `Current Season` / `All Time` rows (column widths MUST match across all rows of a Slack `table` block):

- For each player column, look up the entry in `roundSummary.perPlayer` by `userId`.
- If the player is present, render `String(correct)`.
- If the player is absent from `perPlayer` (on the leaderboard but did not answer this round), render the literal em-dash `"—"`. The empty string `""` is NOT permitted — Slack rejects empty `raw_text` cells with `invalid_blocks`.

Medal prefixes (`"🥇 "`, `"🥈 "`, `"🥉 "`, `"🎀 "`) SHALL be applied ONLY to cells where `correct > 0`, ordered top-4 by the existing `roundSummary.perPlayer` array order (already pre-sorted by the reveal tool). Em-dash cells and `correct === 0` cells SHALL NOT receive medals. Fewer than 4 medal-eligible players → assign medals only for whichever top positions exist.

The label cell for the row SHALL contain the literal text `"This Round"`.

#### Scenario: Multi-question reveal with roundSummary present describes This Round row

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt's multi-question table description references a `This Round` row positioned above `Current Season`
- **AND** the row label is the literal string `"This Round"`
- **AND** the prompt instructs Claude to source the row values from `roundSummary.perPlayer[i].correct`
- **AND** the prompt instructs Claude to render `"—"` (em-dash) for players present on the leaderboard but absent from `roundSummary.perPlayer`
- **AND** the prompt instructs Claude to apply medal prefixes only to cells where `correct > 0`

#### Scenario: Multi-question reveal without roundSummary omits This Round row

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt explicitly states that the `This Round` row is rendered ONLY when `roundSummary` is present in the payload
- **AND** the prompt explicitly states that when any reveal entry's `revealResponses` is `"just-correctness"` or `"no"`, the `roundSummary` field is absent and the `This Round` row is omitted (same gate as the existing Round Summary section block)

#### Scenario: Empty cell uses em-dash, never empty string

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt instructs Claude to use `"—"` (Unicode em-dash) for absent players
- **AND** explicitly warns that empty `raw_text` cells are rejected by Slack with `invalid_blocks`

### Requirement: Multi-question table shapes accommodate the label column

When the `This Round` row is rendered, the `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe two updated table shapes that preserve a left-side label column:

- When `seasonStatus` is PRESENT and `seasonStatus.hasPriorSeasons` is `true` → 4-ROW DUAL-TOTALS TABLE: `(" "/names-header), ("This Round"/round-correct), ("Current Season"/season-correct), ("All Time"/all-time-correct)`.
- When `seasonStatus` is ABSENT or `seasonStatus.hasPriorSeasons` is `false` → 3-ROW LABELED TABLE: `(" "/names-header), ("This Round"/round-correct), ("All Time"/all-time-correct)`. The label column is NEW for this shape (the existing 2-row table has no label column).

When the `This Round` row is NOT rendered (single-question reveal, empty-reveal acknowledgement, or multi-question reveal with `roundSummary` absent), the existing `3-row dual-totals` / `2-row no-label` shapes SHALL ship unchanged.

`column_settings` SHALL still carry one `{ "align": "center" }` entry per column (label column + each player column).

#### Scenario: 4-row dual-totals shape is described under gating

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt describes a 4-ROW DUAL-TOTALS TABLE shape gated to multi-question reveals with `roundSummary` present and `seasonStatus.hasPriorSeasons === true`
- **AND** the row order is names header → This Round → Current Season → All Time
- **AND** the description still references medal application to the Current Season and All Time rows independently of the This Round row

#### Scenario: 3-row labeled shape replaces 2-row when This Round is rendered

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt describes a 3-ROW LABELED TABLE shape used when multi-question reveals fire with `roundSummary` present AND (`seasonStatus` is absent OR `seasonStatus.hasPriorSeasons === false`)
- **AND** the description explicitly notes this shape carries a left-side label column that the legacy 2-row shape lacked
- **AND** the row order is names header → This Round → All Time

#### Scenario: Existing 3-row dual-totals and 2-row shapes ship unchanged when This Round is omitted

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt's single-question branch still describes the legacy 3-row dual-totals shape (no This Round row) and the legacy 2-row shape (no label column, no This Round row)
- **AND** the prompt's multi-question branch with `roundSummary` absent falls back to those same legacy shapes

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
