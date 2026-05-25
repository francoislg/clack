## MODIFIED Requirements

### Requirement: Question-posting prompt enforces strict-membership difficulty gate with one-shot reframe

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain a numbered step flow that opens with the Game Show Presenter persona directive and a "Game: {game}" header, then directs Claude through:

1. **Get category ideas and suggestions** — Call `get_ideas(game: "{game}")`. Read `suggestedAnswer`, `suggestedDifficulty`, and `suggestedDifficultyRange`. Pick one category from `categories.ideas`.
2. **Write a statement with the correct polarity from the start** — branch on `suggestedAnswer`; never write true then flip.
3. **Polarity self-check** — explicitly verify the statement's actual truth matches `suggestedAnswer`; rewrite if not.
4. **Check for duplicates** — Call `find_previous_questions(game: "{game}", text: ...)`; iterate if a match exists in this game's history.
5. **Validate through research** — confirm the statement is actually true/false.
6. **Difficulty gate (strict membership + one-shot reframe)** — self-rate the question on the 1–10 scale. The bucket's `suggestedDifficultyRange` `[min, max]` from `get_ideas` is the strict accept bound (there is no separate threshold). Apply exactly these rules:
   - If the rating lies inside `[min, max]` (inclusive) — proceed to step 7.
   - If the rating is exactly `min - 1` or `max + 1` (one point off the range, above or below) — REFRAME the question once: rewrite it to dial difficulty toward the range, then re-rate the new version on the 1–10 scale independently of the prior rating. If the new rating lies inside `[min, max]`, proceed. Otherwise, REJECT and re-call `get_ideas` for a fresh roll.
   - If the rating is two or more points outside `[min, max]` (either direction) — REJECT immediately and re-call `get_ideas` for a fresh roll; do NOT reframe.
   - After a reframe of a boolean question, the prompt SHALL instruct Claude to re-run the polarity self-check (step 3) on the reframed statement **before** re-rating its difficulty. Order is: reframe → re-run polarity → if polarity fails, REJECT and re-call `get_ideas`; if polarity passes, re-rate the new version on the 1–10 scale. Reframing-by-detail-swap can silently flip a statement's truth value; the polarity gate is what catches this, and running it before the re-rating avoids spending a difficulty rating on a polarity-broken statement.
7. **Choose emojis** relating to the topic.
8. **Save via `save_question(game: "{game}", category, statement, isTrue, emojis)`** — retain `questionId`.
9. **Format using Block Kit** — build the question card blocks (header / warm-up section / card / closer context for boolean; header / section / card with numbered choice layout / context for choice). For boolean questions, the card body SHALL include "👍 TRUE • 👎 FALSE" with 👍 listed before 👎. For choice questions, the numbered-emoji prefix (1️⃣ … 4️⃣) in the card body SHALL match the stored `choices` array order so the bot's automatic reactions align with each option's index.
10. **Post via `post_questions(game: "{game}", items: [{ questionId, blocks }])`** — the tool resolves the channel from game config and derives the reactions from the stored question's type, so the prompt does NOT instruct Claude to specify a channel or a `reactions` list. When the call returns one or more `results[].ok === false` entries, make a follow-up `post_questions` call carrying only the failed items AND pass `appendToPreviousBatch: true` so the retried items share the original batch's `batchId` and reveal together with the original successes.
11. **Terminate via `submit_response({ skip_response: true })`** — no user-facing reply is needed; the run's deliverable is the `post_questions` result.

The prompt SHALL invite Claude to invent a style each day and include at least one concrete example for inspiration.

The prompt SHALL NOT instruct Claude to pass `reactions: [...]` to any tool. Reactions are derived inside `post_questions` and SHALL NOT appear in the prompt's tool-call instructions.

The prompt SHALL NOT reference `minimumDifficultyThreshold` (the field is removed from the `get_ideas` response). The prompt SHALL NOT enumerate a fixed bucket→range mapping (e.g. "Easy = 4–6, Medium = 7–8, Hard = 9–10") because the ranges are now configurable per format via the `difficulty` axis and surfaced as `suggestedDifficultyRange`.

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
- **THEN** the prompt instructs Claude to re-run the polarity self-check (step 3) on the reframed statement before continuing to the next step
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
