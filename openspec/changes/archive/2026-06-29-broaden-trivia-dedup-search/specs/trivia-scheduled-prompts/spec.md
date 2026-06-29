## MODIFIED Requirements

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
