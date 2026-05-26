## MODIFIED Requirements

### Requirement: Question-posting prompt step flow

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain a numbered step flow that opens with the Game Show Presenter persona directive and a "Game: {game}" header, then directs Claude through:

1. **Get category ideas and suggestions** — Call `get_ideas(game: "{game}")`. Read `suggestedAnswer` and `suggestedDifficulty`. Pick one category from `categories.ideas`.
2. **Write a statement with the correct polarity from the start** — branch on `suggestedAnswer`; never write true then flip.
3. **Polarity self-check** — explicitly verify the statement's actual truth matches `suggestedAnswer`; rewrite if not.
4. **Check for duplicates** — Call `find_previous_questions(game: "{game}", text: ...)`; iterate if a match exists in this game's history.
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

#### Scenario: Reframe step re-runs polarity self-check for boolean questions

- **WHEN** the BOOLEAN_FACT or BOOLEAN_TOPICAL flow's reframe step is inspected
- **THEN** the prompt instructs Claude to re-run the polarity self-check on the reframed statement before continuing to the difficulty re-rating

#### Scenario: Prompt routes posting through post_questions

- **WHEN** the prompt content is inspected
- **THEN** the returned text instructs Claude to call `post_questions(game: "{game}", items: [{ questionId, blocks }])` after `save_question`
- **AND** does NOT instruct Claude to call `submit_response` with `reactions` to deliver the question
- **AND** does NOT instruct Claude to pass a `channel` or a `reactions` field to `post_questions`

#### Scenario: Prompt terminates with skip_response

- **WHEN** the prompt content is inspected
- **THEN** the returned text instructs Claude to call `submit_response({ skip_response: true })` after `post_questions`

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
- `reveals.length > 1`: MULTI-QUESTION layout — brief per-question verdicts plus a "Round Summary" section sourced from `roundSummary.perPlayer`. Trades verbose voter-bucket sections for an aggregate scoreboard.

#### Scenario: Single-question branch describes the new voter buckets

- **WHEN** the prompt's single-question branch is inspected
- **THEN** the returned text describes rendering `correct`, `incorrect`, and `noAnswer` sections (when present per the `revealResponses` mode)
- **AND** does NOT reference `fenceSitters` or `wildcards`
- **AND** describes the per-mode rendering branches for `"yes"`, `"just-correctness"`, and `"no"`

#### Scenario: Empty-reveals branch unchanged

- **WHEN** the prompt's empty-reveals branch is inspected
- **THEN** the behavior is unchanged from prior to this proposal — render the acknowledgement plus the cumulative leaderboard
