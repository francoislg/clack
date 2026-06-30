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
4. **Check for duplicates** — Call `find_previous_questions({ keywords: [...], match: "any" })`. The call SHALL OMIT the `games` argument so the scan spans every game (duplicate facts in sibling games still count as duplicates) and SHALL NOT pass a `categories` argument (duplicate detection stays cross-category). The keyword list SHALL include the question's **primary subject** — the specific entity the question hinges on, i.e. the part that VARIES within its category, NOT the template words the category shares (for the category "country that is a primary producer of X" the subject is `X` itself, e.g. `coffee`, not "country"/"producer") — PLUS the **answer** as a recall aid, PLUS 1–3 further distinctive terms (names, numbers, rare nouns). The answer is included to widen the candidate net, NOT as a duplication verdict: a prior row sharing the same answer in a DIFFERENT context (different subject/framing) is NOT a duplicate. For each returned row, inspect its `matchedKeywords` and `statement` to decide whether the row covers the same underlying fact in any framing or polarity; if any candidate is a duplicate, return to step 2 and write a different statement. If the result set is uninformatively wide (many rows matching only on common words), re-call with sharper keywords while retaining the primary subject.
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

#### Scenario: Duplicate-detection step mandates the primary subject and treats the answer as a recall aid

- **WHEN** the duplicate-detection step (step 4) is inspected
- **THEN** it instructs Claude to include the question's primary subject (the entity the question hinges on, not the template words the category shares) as a keyword
- **AND** it instructs Claude to include the answer as a recall aid to widen the candidate net
- **AND** it states that a prior row sharing the same answer in a different context is NOT a duplicate
- **AND** it does NOT assert that a duplicate necessarily shares both the subject and the answer

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

### Requirement: Emoji selection non-spoiler gate

The scheduled question-generation prompt SHALL define a shared **EMOJI SELECTION GATE** that constrains the `emojis` field so it never reveals the answer. The gate SHALL follow the same shared-definition pattern as the prompt's other gates (`DUPLICATE CHECK GATE`, `DIFFICULTY GATE`, `STATEMENT–CHOICES NON-OVERLAP GATE`, `HINT DRAFTING GATE`): defined once and invoked from each generation path by wording such as "apply the EMOJI SELECTION GATE (shared definition above)."

The gate SHALL instruct Claude that the per-question `emojis` decorate the **category** (the card title renders `<emoji> <Category>`), and SHALL forbid any emoji that depicts the answer or the question's specific subject — e.g. a country-flag emoji on a question about that country's flag, an animal emoji whose species is the answer, or a landmark emoji that identifies the answer. When a topic-literal emoji would leak the answer, the gate SHALL direct Claude to fall back to a category-level or generic emoji (e.g. 🌍/🏳️ for a geography/flag question, not 🇪🇨). This mirrors the non-spoiler treatment already required for `media.altText` on visual questions.

Every emoji-selection step across all generation paths — fact boolean, fact choice, fact freeform, and the visual choice/boolean/freeform paths — SHALL invoke this gate in place of free-form "choose emojis relating to the topic" wording.

#### Scenario: Gate is defined once and referenced by every path

- **WHEN** `SEND_QUESTIONS_INSTRUCTIONS` (and the staged-prep / post prompts that share the per-slot generation blocks) is assembled
- **THEN** it contains exactly one EMOJI SELECTION GATE definition
- **AND** each of the six emoji-selection steps (fact boolean, fact choice, fact freeform, visual choice, visual boolean, visual freeform) references that gate rather than instructing Claude to "choose emojis relating to the topic" directly

#### Scenario: Gate forbids answer-revealing emojis

- **WHEN** the EMOJI SELECTION GATE text is rendered into the prompt
- **THEN** it instructs Claude that emojis decorate the category, not the answer
- **AND** it forbids emojis that depict the answer or the question's specific subject (e.g. a country-flag emoji on a flag question)
- **AND** it directs Claude to fall back to a category-level or generic emoji when a topic-literal emoji would leak the answer

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

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL open with the Game Show Presenter persona directive and a "Game: {game}" header, then direct Claude through a renderer flow consisting of these steps, in order:

1. **Call `compute_answers(game: "{game}")`** and read its returned payload. The prompt SHALL describe the payload's shape (the `reveals[]`, the processed `batchId`, `leaderboard`, `roundSummary`, and optional `seasonStatus` fields) so Claude can render it without inventing structure. The prompt SHALL describe each reveal entry's `voters` as a discriminated union on `voters.revealResponses` with three variants:
   - `"yes"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters in `correct[]` and `incorrect[]` carry an `answerText` field that SHOULD be quoted in the reveal.
   - `"just-correctness"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters DO NOT carry `answerText`. The prompt SHALL instruct Claude to enumerate the named voters (e.g. "Marc and Sarah nailed it; Bob missed it") but SHALL NOT quote any typed freeform text — and SHALL note that the text is not in the payload to quote.
   - `"no"` → `voters` carries ONLY `reactions`. The `correct`, `incorrect`, and `noAnswer` fields are physically absent. The prompt SHALL instruct Claude to render the answer plus reactions commentary plus the leaderboard, and NOT to invent or speculate about who voted what.

   The prompt SHALL describe `voters.reactions` as carrying every reactor's FULL emoji set, with bot + cheaters already excluded. The prompt SHALL describe `roundSummary` as ALWAYS present and INDEPENDENT of `revealResponses` (it is the per-player scoreboard aggregate, not a per-question display) — its `perPlayer` array is empty only when nobody answered this round.

2. **Call `update_answers_block(game: "{game}", batchId: <the batchId returned by `compute_answers`>)`** to edit each revealed question's original card into its final static state. The prompt SHALL instruct Claude to pass through the `batchId` that `compute_answers` reported, and SHALL state that this step performs the deterministic card edit (it does not score, judge, or post a new message). When `compute_answers` returned `reveals: []`, Claude SHALL skip this step.

3. **On the season's last fire only, call `start_new_season(...)`** when `seasonStatus.isLastFireOfSeason === true`. The prompt SHALL state that `start_new_season` is idempotent (safe if rollover already happened) and that `compute_answers` itself performs no rollover. When seasons are disabled or `isLastFireOfSeason` is false, Claude SHALL skip this step.

4. **Render the payload via `submit_response`** using the Game Show Presenter voice and Block Kit conventions:
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

#### Scenario: Reveal prompt describes roundSummary as always present and mode-independent

- **WHEN** the prompt's payload-shape description is inspected
- **THEN** `roundSummary` is described as ALWAYS present and INDEPENDENT of `revealResponses`
- **AND** the prompt states `roundSummary.perPlayer` is empty only when nobody answered this round

#### Scenario: Reveal prompt treats reactions as commentary

- **WHEN** the prompt's reactions section is inspected
- **THEN** the text instructs Claude to riff on per-user emoji sets purely for flavor
- **AND** explicitly states that reactions do not affect scoring
- **AND** invites Claude to correlate reactions with the same user's answer when there is something funny to say (correct + 🎯, incorrect + 🤔, no-answer + 🐢, etc.)

#### Scenario: Reveal prompt sequences compute, projection, and render

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** it directs Claude to call `compute_answers` first, then `update_answers_block` with the reported `batchId`, then `submit_response`
- **AND** it directs Claude to call `start_new_season` only when `seasonStatus.isLastFireOfSeason` is true
- **AND** it states `compute_answers` performs no Slack card edit and no season rollover

#### Scenario: Reveal prompt skips projection on empty reveals

- **WHEN** `compute_answers` returns `reveals: []`
- **THEN** the prompt instructs Claude to skip `update_answers_block` and `start_new_season` and to skip the response (per the existing empty-reveal handling)

### Requirement: requiredTools per spec

The `buildGameSpecs` function SHALL emit `requiredTools` for each cron spec containing ONLY tools called on 100% of valid runs of that spec (the `submit_response` gate force-calls every listed tool, so a conditional tool would be forced on runs where it does not apply):

- For `<game>:question` (question-posting): `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]` when the game is NOT flexible, and `["mcp__trivia__get_ideas"]` when `game.format?.flexible === true` (a flexible fire may legitimately post zero questions). `save_question`, `find_previous_questions`, and `find_previous_subjects` SHALL NOT appear — they are skipped by some generation paths (predictions skip the dedup gate; staged-pool slots skip `save_question`; `find_previous_subjects` runs only in the image subflow).
- For `<game>:reveal` (reveal): `["mcp__trivia__compute_answers"]`. `compute_answers` is the only tool called on every reveal (including an empty batch). `update_answers_block`, `start_new_season`, `settle_question`, and `update_question` SHALL NOT appear — each is invoked by the reveal prompt only conditionally. `submit_answers` and `process_reveal_answers` SHALL NOT appear (removed/renamed).

#### Scenario: Non-flexible question spec requires get_ideas and post_questions

- **WHEN** `buildGameSpecs` produces the `main:question` spec for a non-flexible game
- **THEN** `requiredTools` equals `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]`
- **AND** it does NOT include `"mcp__trivia__save_question"` or `"mcp__trivia__find_previous_questions"`

#### Scenario: Flexible question spec omits post_questions

- **WHEN** `buildGameSpecs` produces the question spec for a game with `format.flexible === true`
- **THEN** `requiredTools` equals `["mcp__trivia__get_ideas"]`
- **AND** it does NOT include `"mcp__trivia__post_questions"`

#### Scenario: Reveal spec requires only compute_answers

- **WHEN** `buildGameSpecs` produces the `main:reveal` spec
- **THEN** `requiredTools` equals `["mcp__trivia__compute_answers"]`
- **AND** it does NOT include `"mcp__trivia__update_answers_block"`, `"mcp__trivia__start_new_season"`, `"mcp__trivia__settle_question"`, `"mcp__trivia__update_question"`, `"mcp__trivia__submit_answers"`, or `"mcp__trivia__process_reveal_answers"`
- **AND** the list is identical whether or not seasons are enabled for the game

### Requirement: Reveal prompt branches on reveals.length

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL explicitly branch on `reveals.length`:

- `reveals.length === 0`: POST NOTHING — terminate the run with `submit_response({ skip_response: true })`. No acknowledgement and no leaderboard render when there is no batch to reveal; a silent skip is preferred over a "nothing to reveal" message.
- `reveals.length === 1`: SINGLE-QUESTION layout — full per-voter-bucket sections (`correct`, `incorrect`, `noAnswer`) plus reactions commentary plus the leaderboard. The `This Round` leaderboard row SHALL be rendered whenever `roundSummary.perPlayer` is non-empty, per "Reveal table leads with This Round".
- `reveals.length > 1`: MULTI-QUESTION layout — brief per-question verdicts; the per-player round scoreboard is carried by the `This Round` leaderboard-table row (not a prose block). Trades verbose voter-bucket sections for the aggregate `This Round` row. The prompt SHALL NOT instruct a prose "Round Summary" `section` block, which would duplicate that row.

The `This Round` row's presence SHALL be gated solely on `roundSummary.perPlayer` being non-empty — NOT on `reveals.length` and NOT on any entry's `revealResponses` mode.

#### Scenario: Single-question branch describes the new voter buckets

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the returned text describes rendering `correct`, `incorrect`, and `noAnswer` sections (when present per the `revealResponses` mode)
- **AND** does NOT reference `fenceSitters` or `wildcards`
- **AND** describes the per-mode rendering branches for `"yes"`, `"just-correctness"`, and `"no"`

#### Scenario: Empty-reveals branch posts nothing

- **WHEN** the prompt's empty-reveals branch is inspected
- **THEN** it instructs Claude to POST NOTHING — terminate with `submit_response({ skip_response: true })`
- **AND** it does NOT instruct rendering an acknowledgement or the cumulative leaderboard

#### Scenario: Single-question layout renders This Round row when perPlayer non-empty

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the prompt instructs Claude to render the `This Round` leaderboard row whenever `roundSummary.perPlayer` is non-empty
- **AND** the prompt does NOT gate the `This Round` row on `reveals.length` or on the reveal mode

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

### Requirement: Answer-reveal prompt renders the `"just-winners"` variant

The answer-reveal prompt SHALL describe a fourth `voters` discriminated-union variant keyed on `voters.revealResponses === "just-winners"`, carrying `correct` (named voters), `incorrectCount` (integer), `noAnswerCount` (integer), and `reactions`. The prompt SHALL instruct Claude to:

- Name and celebrate the `correct` voters (e.g. "<@U1> and <@U2> got it right — nice!"), quoting freeform `answerText` when present.
- Render an ANONYMOUS miss line derived from the counts (e.g. "*(3 others missed it)*") WITHOUT naming, speculating about, or implying the identity of any misser.
- When `correct` is empty and `incorrectCount > 0`, render an "everyone got fooled / nobody nailed it" closer instead of a winners line.
- Preserve the reactions commentary exactly as in the other modes.

The prompt SHALL forbid naming or guessing any incorrect or no-answer voter in this mode — the payload carries no such names. This branch SHALL apply in both the single-question and multi-question reveal layouts, and SHALL participate in the same `roundSummary`-absent / no-"This Round"-row gate as the `"just-correctness"` and `"no"` modes.

#### Scenario: Winners named, missers counted

- **WHEN** Claude renders a reveal entry whose `voters.revealResponses === "just-winners"` with `correct` containing two users and `incorrectCount: 3`
- **THEN** the rendered message names the two correct users
- **AND** includes an anonymous line reflecting that 3 others missed it
- **AND** names no incorrect or no-answer voter

#### Scenario: Nobody got it right

- **WHEN** Claude renders a `"just-winners"` entry with empty `correct` and `incorrectCount` greater than 0
- **THEN** the rendered message contains an "everyone missed it" style closer
- **AND** does not claim anyone got it right

### Requirement: Admin instructions preserve prompt structure by default, override only on explicit structural intent

The scheduled-prompt ADMIN GUIDANCE clauses (both the generation path that consumes `get_ideas`'s `instructions` / `additionalInstructions`, and the reveal path that consumes `process_reveal_answers`'s `instructions` / `additionalInstructions`) SHALL direct Claude to treat the post as a set of independent, individually-addressable structural blocks and to apply each admin instruction as follows:

- When an instruction does NOT explicitly call for a structural change, Claude SHALL preserve the prompt's block structure exactly (no block added, removed, replaced, or reordered) and SHALL apply the instruction only to the content/tone of the block(s) it names, or to overall tone when it names no specific block.
- When an instruction EXPLICITLY calls for a structural change — adding, removing, replacing, or reordering a block, or omitting the leaderboard table — Claude SHALL make exactly that change and nothing more, and that explicit instruction SHALL take priority over the prompt's default layout.
- An instruction that names a single block SHALL affect only that block; it SHALL NOT alter sibling blocks.

The generation-path clause SHALL NOT instruct Claude to apply admin instructions to "any other aspect" of the generated question; its scope SHALL be limited to content and tone except where an instruction explicitly requests a structural change.

The clauses SHALL state that the answer buttons appended by `post_questions` (boolean / choice / freeform affordances) are tool-owned and are NOT removable by an admin instruction; the leaderboard `table` argument to `submit_response` is Claude-authored and SHALL be omitted when an instruction explicitly requests its removal.

The block labels in the question-card layout SHALL be worded so that common admin terms for the warm-up patter `section` block — "preamble", "opener", "warm-up" — map unambiguously to that block.

#### Scenario: Non-structural instruction preserves the card and table

- **WHEN** an admin instruction such as "keep the preamble short" is resolved into `instructions` / `additionalInstructions` for a scheduled question post
- **THEN** the prompt directs Claude to shorten the warm-up patter `section` block's content only
- **AND** the `header`, question `card`, closer `context` block, and (on reveal) the leaderboard table remain structurally intact

#### Scenario: Explicit structural instruction overrides the default layout

- **WHEN** an admin instruction explicitly states "don't use a card for the question, use a plain section"
- **THEN** the prompt directs Claude to replace the question `card` block with a `section` block
- **AND** all other blocks retain their default structure
- **AND** the explicit instruction takes priority over the prompt's FOUR-BLOCK default

#### Scenario: Explicit instruction omits the leaderboard table

- **WHEN** an admin instruction explicitly states "don't include the leaderboard table" during a reveal
- **THEN** the prompt directs Claude to omit the `table` argument to `submit_response`
- **AND** the reveal blocks otherwise render per the default reveal layout

#### Scenario: Instruction cannot remove tool-appended answer buttons

- **WHEN** an admin instruction asks to remove or omit the answer buttons (TRUE/FALSE, numbered choices, or the freeform Answer button)
- **THEN** the prompt states the answer buttons are appended by `post_questions` and are not removable by instruction
- **AND** Claude does not attempt to suppress them in the authored `blocks` array

#### Scenario: Single-block instruction does not bleed into siblings

- **WHEN** an admin instruction targets one named block (e.g. a closer-specific instruction)
- **THEN** the prompt directs Claude to apply it only to that block
- **AND** the warm-up patter, card, and other blocks are unaffected

### Requirement: Reveal leaderboard labels are localized via the trivia dictionary

The reveal prompt SHALL be constructed with its leaderboard structural label tokens already rendered in the configured language, sourced from the trivia i18n dictionary (`sdk.t()` / the registered `en`/`fr` tables), NOT emitted as fixed English literals for Claude to translate. This applies to every leaderboard row-label cell the prompt dictates: `This Round`, `Current Season`, `All Time`, and the seasons-off totals labels. Because the built prompt already carries the configured language's label, Claude copies the dictated token verbatim into the Slack `table` cell — the same verbatim-copy behavior that previously leaked English now delivers the localized label.

The reveal prompt SHALL therefore be produced by a builder function (evaluated at cron-reconcile time, after the plugin translator is wired) rather than being a fixed string constant for the localized portions, so its labels resolve against the configured language via the plugin translator (the same `sdk.t` surface, accessed through the plugin's module-level `t`). The worked table examples embedded in the prompt SHALL render their label cells from the same dictionary as the instruction text, so a non-English workspace's examples show the localized labels and Claude cannot anchor on English example cells.

The medal glyphs (`🥇`/`🥈`/`🥉`/`🎀`), the `String(...)` numeric value cells, the em-dash `"—"`, the single-space names-header label `" "`, and player `displayName` cells are language-neutral and SHALL NOT be routed through the dictionary. Free prose around the table (closers, transitions, per-question verdicts) continues to rely on the LANGUAGE directive.

When the configured language is English the dictionary values equal the prior literals (`This Round`, `Current Season`, `All Time`), so the built prompt and resulting output are byte-identical to the pre-change behavior.

#### Scenario: Built reveal prompt carries localized labels in a French workspace

- **GIVEN** the configured language is French
- **WHEN** the reveal prompt is built
- **THEN** the leaderboard row-label tokens in the prompt are the French dictionary values (e.g. `Saison en cours`, `Cumulatif`) rather than English literals
- **AND** the worked table examples in the prompt use those same French label cells
- **AND** the medal glyphs, numeric value cells, and em-dash cells remain unchanged

#### Scenario: English workspace prompt and output are byte-stable

- **GIVEN** the configured language is English
- **WHEN** the reveal prompt is built
- **THEN** the leaderboard row labels resolve to `This Round`, `Current Season`, and `All Time` exactly as before the change

### Requirement: Reveal table leads with This Round

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe a `This Round` leaderboard-table row that is rendered as the FIRST data row (immediately below the names header, ABOVE `Current Season` / `All Time`) whenever `roundSummary.perPlayer` is non-empty. The `This Round` label cell SHALL be the configured language's value for that label, sourced from the trivia i18n dictionary when the prompt is built — NOT a fixed English literal. (See "Reveal leaderboard labels are localized via the trivia dictionary" for the full localization rule covering every row label.)

The row SHALL be sourced from `roundSummary.perPlayer`: for each player column, look up the entry by `userId`; render `String(correct)` when present, or the literal Unicode em-dash `"—"` when the player is on the leaderboard but absent from `roundSummary.perPlayer`. The empty string `""` SHALL NOT be used — Slack rejects empty `raw_text` cells with `invalid_blocks`.

The whole table's COLUMN ORDER SHALL be decided ONCE and shared by every row (the Slack `table` block requires uniform column widths; a player owns exactly one column across all rows):

1. When `roundSummary.perPlayer` is non-empty, order columns by `roundSummary.perPlayer` order (already `correct`-descending), then append any remaining present players (on the leaderboard but absent from `perPlayer`) ordered by `currentSeasonCorrect` descending. Em-dash / absent-this-round players sort LAST.
2. When `roundSummary.perPlayer` is empty, order columns by `currentSeasonCorrect` descending (the existing leaderboard order).

The prompt SHALL instruct that every row (names header, This Round, Current Season, All Time) fills cells in that single shared column order, and SHALL explicitly forbid sorting any single row's cells independently. A consequence SHALL be stated: the leftmost column is the round leader, which need not be the season or all-time leader.

#### Scenario: This Round is the top data row and drives column order

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt positions the `This Round` row directly below the names header and above `Current Season`
- **AND** the prompt instructs Claude to decide the column order once, by `roundSummary.perPlayer` order, and reuse it for every row
- **AND** the prompt forbids sorting individual rows independently

#### Scenario: This Round gated on non-empty perPlayer, not reveals.length or mode

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt states the `This Round` row renders whenever `roundSummary.perPlayer` is non-empty, for both single- and multi-question reveals and ANY reveal mode
- **AND** the prompt states the row is omitted only when `perPlayer` is empty (nobody answered this round)
- **AND** the prompt states the reveal mode (`revealResponses`) NEVER affects this row

#### Scenario: Absent-this-round player uses em-dash and sorts last

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt instructs Claude to render `"—"` for players present on the leaderboard but absent from `roundSummary.perPlayer`
- **AND** those players are ordered after all present-this-round players in the shared column order

#### Scenario: Columns stay aligned when a player is em-dash in one row but numbered in another

- **WHEN** a player did not answer this round (em-dash in `This Round`) but has a non-zero `Current Season` total
- **THEN** the prompt instructs that the player occupies the SAME single column across every row — `"—"` in the `This Round` cell and `String(currentSeasonCorrect)` in the `Current Season` cell — with no row re-sorted to move that player

#### Scenario: Empty perPlayer falls back to season-score column order

- **WHEN** `roundSummary.perPlayer` is empty (nobody answered this round)
- **THEN** the prompt instructs Claude to order columns by `currentSeasonCorrect` descending
- **AND** the `This Round` row is omitted

### Requirement: Dense-rank medal assignment across leaderboard rows

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL describe a SINGLE medal-assignment rule applied independently to each medaled leaderboard row (`This Round`, `Current Season`, `All Time`) and reused by the season-finale podium and All-Time table (see `trivia-seasons`):

- Rank by DISTINCT value, descending: the 1st distinct value receives `"🥇 "`, the 2nd `"🥈 "`, the 3rd `"🥉 "`, the 4th `"🎀 "`.
- Every cell holding a given value receives that value's medal — ties SHARE a medal (e.g. two players at the top value both get `"🥇 "`).
- Cells with value `0`, em-dash cells, and absent players SHALL NEVER receive a medal — even to fill an otherwise-empty top-4 slot.
- Fewer than 4 distinct medal-eligible values → assign medals only for the distinct values that exist.
- Medals SHALL use the Unicode characters, NOT Slack shortcodes (`:first_place_medal:` / `:ribbon:` render as literal text inside `table` cells).

#### Scenario: Tie at the top shares gold

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt states that all players sharing the top value in a row receive `"🥇 "`
- **AND** the next distinct value receives `"🥈 "`

#### Scenario: Zero and em-dash never medal

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt states that `0`-value cells and em-dash cells receive no medal under any circumstance

#### Scenario: Fourth distinct value wears the ribbon

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the prompt assigns `"🎀 "` to the 4th distinct value in a row
- **AND** assigns medals to only the distinct values that exist when there are fewer than four

### Requirement: Empty correct bucket renders expanded answer detail

When a reveal entry's `correct` bucket is empty (no player answered correctly), the `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL instruct Claude to replace misser-naming with an EXPANDED explanation of the correct answer — a "nobody got it — here's the full story" treatment that teaches the room about the answer, rather than listing who got it wrong.

This SHALL apply to every `revealResponses` mode that exposes whether anyone was correct:

- In `"yes"` and `"just-correctness"` modes (named buckets), the expanded detail SHALL stand in place of the INCORRECT name-listing section.
- In `"just-winners"` mode (counts only), the expanded detail SHALL accompany the existing anonymous "everyone got fooled / nobody nailed it" line; no misser names exist to list.

The expanded detail SHALL NOT name or imply any misser beyond what the mode already permits. The treatment is appropriate whether players tried and all missed or nobody answered at all (both leave `correct` empty).

#### Scenario: Named-bucket mode swaps misser list for answer detail

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected for the `"yes"` / `"just-correctness"` branches
- **THEN** the prompt instructs Claude, when `correct` is empty, to render an expanded explanation of the correct answer instead of an INCORRECT name section

#### Scenario: just-winners mode pairs the fooled line with detail

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected for the `"just-winners"` branch
- **THEN** the prompt instructs Claude, when `correct` is empty, to render the anonymous "everyone got fooled" line together with an expanded explanation of the answer
- **AND** the prompt names no misser

### Requirement: Trivia Plugin Self-Disables When Crons Are Off

The trivia plugin's init function SHALL inspect `sdk.capabilities.crons` before performing any registrations. When the capability is `false`, the plugin SHALL:

- Call `sdk.error("Trivia requires the cron scheduler. Enable it via \`config.cron.enabled: true\`.")` exactly once.
- Return from init without calling `sdk.reconcileCronJobs`, `sdk.registerTool`, `sdk.addInstruction`, `sdk.addTopicInstruction`, or `sdk.registerIntegration`.

The user-visible reason text SHALL name the config key (`config.cron.enabled`) so an admin reading the Home Tab error banner can fix the misconfiguration without consulting external docs.

#### Scenario: Trivia init bows out when crons disabled

- **GIVEN** `config.cron.enabled` is `false`
- **WHEN** the trivia plugin's init runs
- **THEN** the plugin calls `sdk.error` once with the documented reason text
- **AND** the plugin returns
- **AND** no trivia tools are registered
- **AND** no trivia instructions are registered
- **AND** no trivia integrations are registered
- **AND** `data/state/cron-jobs.json` is unchanged with respect to trivia entries

#### Scenario: Trivia loads normally when crons enabled

- **GIVEN** `config.cron.enabled` is `true`
- **WHEN** the trivia plugin's init runs
- **THEN** the plugin SHALL NOT call `sdk.error` due to the cron capability
- **AND** all trivia tools, instructions, integrations, and cron specs SHALL register as they do today

#### Scenario: Plugin status visible to admin

- **GIVEN** `config.cron.enabled` is `false`
- **AND** the trivia plugin has bowed out via `sdk.error`
- **WHEN** an admin opens the Home Tab
- **THEN** the `Status > Plugins` section shows the trivia row with an error banner containing the documented reason text

### Requirement: Reveal prompt authors per-card narrative when `includeRevealInQuestions` is yes

`PROCESS_REVEAL_INSTRUCTIONS` SHALL branch on the payload's `includeRevealInQuestions`. When `"yes"`, for EACH revealed question the prompt SHALL instruct Claude to call `update_question({ game, questionId, revealBlocks })` with that question's narrative (verdict, WHY, the fun-fact comment, and — when nobody got it — the expanded "nobody cracked it" teaching) BEFORE `update_answers_block` projects the cards, so each card shows facts + that narrative. When `"no"`, the prompt SHALL NOT author card narrative (today's flow). The `revealBlocks` SHALL contain only narrative, never the deterministic facts (which `update_answers_block` renders from `answers.json`).

#### Scenario: Prompt describes the yes branch

- **WHEN** `PROCESS_REVEAL_INSTRUCTIONS` is inspected
- **THEN** the `"yes"` branch instructs a per-question `update_question` call carrying the narrative, before `update_answers_block`
- **AND** the `"no"` branch does not author card narrative

### Requirement: Reveal prompt branches the summary on `finalRevealSummary`

`PROCESS_REVEAL_INSTRUCTIONS` SHALL branch the closing-summary rendering on the payload's `finalRevealSummary`, with type-gated instructions so each branch is a single linear path. The leaderboard `table` SHALL be posted top-level in every branch; only the verdict/WHY/voter narrative varies:

- **`"yes"`** → today's flow: narrative blocks + leaderboard `table` in one top-level `submit_response`.
- **`"no"`** → a top-level `submit_response` carrying the leaderboard `table` and a brief closer only; NO verdict/WHY/voter narrative blocks.
- **`"in-thread"`** → a top-level `submit_response` whose blocks carry the leaderboard `table` and a localized "see the responses in thread!" pointer (`sdk.t()`), with the full verdict/WHY/voter narrative supplied as `thread_replies` (posted as a threaded reply under the primary).

On the season's last fire the finale (podium + gated all-time table) SHALL be rendered top-level in every branch (per `trivia-final-reveal-summary`); in `"in-thread"` the day's per-question verdicts still go to `thread_replies` while the finale stays top-level.

#### Scenario: Prompt describes all three summary branches

- **WHEN** `PROCESS_REVEAL_INSTRUCTIONS` is inspected
- **THEN** it branches on `finalRevealSummary`
- **AND** the `"yes"` branch posts narrative + leaderboard top-level
- **AND** the `"no"` branch posts the leaderboard top-level with no narrative
- **AND** the `"in-thread"` branch posts the leaderboard + localized pointer top-level and the narrative via `thread_replies`

#### Scenario: Leaderboard is top-level in every branch

- **WHEN** any of the three branch instructions is inspected
- **THEN** the leaderboard `table` is posted on the top-level (primary) `submit_response`, never only in the thread

#### Scenario: in-thread instructs both the pointer and the thread reply

- **WHEN** the `"in-thread"` branch is inspected
- **THEN** it instructs Claude to include the localized pointer in the top-level blocks
- **AND** to supply the narrative as `thread_replies`

### Requirement: Puzzle-quality gate

The scheduled question-generation prompt SHALL define a shared **PUZZLE QUALITY GATE** that constrains question quality across every generation path. The gate SHALL follow the same shared-definition pattern as the prompt's other gates (`DUPLICATE CHECK GATE`, `DIFFICULTY GATE`, `EMOJI SELECTION GATE`): defined exactly once and invoked from each path body by wording such as "apply the PUZZLE QUALITY GATE (shared definition above)." Every text and visual path body — fact/topical × boolean/choice/freeform — SHALL invoke the gate immediately before its `save_question` step.

The gate SHALL instruct Claude to reason explicitly (not merely assert "pass") about the question as a puzzle, evaluating at minimum five checks and revising or re-rolling on failure:

1. **Solvable by knowing, not guessing** — a knowledgeable player could reason to the answer; the question SHALL NOT reduce to a coin-flip or to recalling an isolated datum disconnected from understanding (an exact year, a raw figure, a one-off statistic). This check carries the principle of the former boolean-only `AVOID YEAR/DATE ANCHORING` block and applies it to every format.
2. **No surface tell** — stripped of its truth value, the question's phrasing, specificity, length, or confidence SHALL NOT tilt a clueless player toward the answer. The gate SHALL state the per-format manifestation inline: boolean — a true and a false framing must read equally plausible; choice — the correct option must not stand out from the distractors in length, specificity, or confidence; freeform — the prompt must not telegraph the answer.
3. **Doubt fits the difficulty** — the answer SHALL be genuinely ambiguous on the surface yet resolvable by a player with relevant knowledge and reasoning; difficulty SHALL come from that ambiguity, never from obscurity or memorization.
4. **Flavor never leaks** — surfaced non-question text (patter, subtitle, emojis, hint, alt text) SHALL NOT narrow or reveal the answer. This check reinforces the existing post-time **NO-SPOILER GATE** rather than restating it; it SHALL reference that gate, not duplicate its prose.
5. **Worth caring about** — the subject SHALL be something the audience would plausibly find interesting or relevant (for topical, genuinely salient).

The gate SHALL instruct Claude that, when a question cannot be fixed to pass, re-rolling is preferred over shipping a weak question. The check-1 principle SHALL be expressed once in this shared gate — including at least one worked example contrasting a bad isolated-datum question with a good knowledge-resolvable reframe — so it applies to choice and freeform paths as well as boolean.

#### Scenario: Gate is defined once and referenced by every path

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS`, `PREP_QUESTIONS_INSTRUCTIONS`, and `POST_QUESTIONS_INSTRUCTIONS` constants are assembled
- **THEN** they contain exactly one PUZZLE QUALITY GATE definition
- **AND** each of the six path bodies (text boolean/choice/freeform and visual boolean/choice/freeform) references that gate immediately before its `save_question` step

#### Scenario: Gate mandates explicit reasoning over a checklist

- **WHEN** the PUZZLE QUALITY GATE text is rendered into the prompt
- **THEN** it instructs Claude to reason explicitly about the question as a puzzle rather than only asserting "pass"

#### Scenario: Gate instructs re-roll over shipping a weak question

- **WHEN** the PUZZLE QUALITY GATE text is rendered into the prompt
- **THEN** it instructs Claude that re-rolling is preferred over shipping a question that cannot be fixed to pass the checks

#### Scenario: Gate forbids surface tells and unverifiable-datum questions

- **WHEN** the PUZZLE QUALITY GATE text is rendered into the prompt
- **THEN** it instructs Claude that a question stripped of its truth value must not let phrasing or specificity reveal the answer
- **AND** it instructs Claude that the answer must be solvable by knowledge and reasoning, not by recalling an isolated unverifiable datum
- **AND** the boolean-only `AVOID YEAR/DATE ANCHORING` block is no longer present as a separate boolean-path block

#### Scenario: Gate subsumes the year/date-anchoring principle with a worked example

- **WHEN** the PUZZLE QUALITY GATE text is inspected
- **THEN** it contains the "solvable by knowing, not an isolated datum" principle absorbed from the former boolean-only block
- **AND** it includes at least one worked example contrasting a bad isolated-datum question with a good knowledge-resolvable reframe

#### Scenario: Flavor-leak check defers to the existing NO-SPOILER GATE

- **WHEN** the PUZZLE QUALITY GATE's flavor check is inspected
- **THEN** it references the existing post-time NO-SPOILER GATE
- **AND** it does NOT introduce a second, duplicate body of flavor-leak prose

### Requirement: Difficulty is expressed as doubt, not obscurity

The scheduled question-generation prompt SHALL frame question difficulty as the amount of genuine doubt a knowledgeable player experiences — not as the rarity of the underlying fact. The `DIFFICULTY GATE`'s reframe levers SHALL NOT direct Claude to raise difficulty by selecting a more obscure fact; for boolean paths the levers SHALL instead adjust the plausibility of the statement (more recognizable/plausible for easier, more subtle and ambiguous-either-way for harder). The strict-membership band mechanics (`suggestedDifficultyRange` `[min, max]`, one-shot reframe, re-roll) SHALL be preserved unchanged.

#### Scenario: Boolean difficulty levers target doubt

- **WHEN** the difficulty-gate reframe levers are inspected
- **THEN** for boolean paths they instruct Claude to make the statement more or less plausibly either-way to dial difficulty
- **AND** they do NOT instruct Claude to raise boolean difficulty by choosing a more obscure fact

### Requirement: Question-posting prompt has a prediction generation path

When a slot resolves `questionType: "prediction"`, the question-posting prompt SHALL drive a PREDICTION MODIFIER on top of the answer-shape path body: Claude uses `WebSearch` to find an UPCOMING event whose outcome resolves before the reveal and is objectively checkable, captures a `sourceUrl`, drafts a `boolean` / `choice` / `freeform` question about that future outcome, and saves it via `save_question` WITHOUT an answer key (no `isTrue` / `correctIndex` / `expectedAnswer`). The answer-key gates (polarity self-check, distractor plausibility) are skipped; the difficulty and duplicate gates still apply. This path is additive — the fact/topical paths are unchanged.

#### Scenario: prediction path researches an upcoming event and saves no key

- **WHEN** the question prompt runs for a slot that resolved `questionType: "prediction"`
- **THEN** Claude WebSearches an upcoming event, drafts a question about its future outcome
- **AND** calls `save_question` with `questionType: "prediction"`, a `sourceUrl`, and no answer key

#### Scenario: fact/topical paths unchanged

- **WHEN** the question prompt runs for a `fact` or `topical` slot
- **THEN** generation behaves exactly as before this change (the prediction path is not entered)

### Requirement: Answer-reveal prompt settles or invalidates predictions before scoring

The answer-reveal prompt SHALL include a leading SETTLE step: when `compute_answers` reports `UNDECIDED_PREDICTIONS`, for each listed prediction Claude uses `WebSearch` to find the result and either calls `settle_question({ outcome })` (result known) or `settle_question({ invalidate: true, invalidatedReason })` (postponed / unresolvable), then re-calls `compute_answers`. The reveal `requiredTools` SHALL include `settle_question`.

#### Scenario: result found → answer

- **WHEN** a prediction's event has concluded with a known result
- **THEN** Claude calls `settle_question` with the `outcome`, then re-runs `compute_answers`, which scores it

#### Scenario: result unavailable → invalidate

- **WHEN** a prediction's event is postponed or its result is unresolvable
- **THEN** Claude calls `settle_question` with `invalidate: true` + a reason, and the question is reported in `invalidatedQuestions` (worth 0)

### Requirement: Reveal prompt renders invalidated questions

The answer-reveal prompt SHALL mention each entry in the payload's `invalidatedQuestions` as an "invalidated — <reason>" note (worth 0, no result). Resolved questions in the same fire render exactly as today.

#### Scenario: invalidated question is mentioned in the reveal

- **WHEN** a reveal fire's payload contains `invalidatedQuestions`
- **THEN** the reveal post notes each as invalidated with its reason, and does not present a result for it

