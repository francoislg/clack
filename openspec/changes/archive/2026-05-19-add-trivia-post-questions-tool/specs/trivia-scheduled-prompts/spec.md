## MODIFIED Requirements

### Requirement: Question-posting prompt step flow

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain a numbered step flow that opens with the Game Show Presenter persona directive and a "Game: {game}" header, then directs Claude through:

1. **Get category ideas and suggestions** — Call `get_ideas(game: "{game}")`. Read `suggestedAnswer` and `suggestedDifficulty`. Pick one category from `categories.ideas`.
2. **Write a statement with the correct polarity from the start** — branch on `suggestedAnswer`; never write true then flip.
3. **Polarity self-check** — explicitly verify the statement's actual truth matches `suggestedAnswer`; rewrite if not.
4. **Check for duplicates** — Call `find_previous_questions(game: "{game}", text: ...)`; iterate if a match exists in this game's history.
5. **Validate through research** — confirm the statement is actually true/false.
6. **Difficulty gate** — self-rate 1–10. Easy = 4–6, Medium = 7–8, Hard = 9–10. Reject and regenerate if ≤ 3/10.
7. **Choose emojis** relating to the topic.
8. **Save via `save_question(game: "{game}", category, statement, isTrue, emojis)`** — retain `questionId`.
9. **Format using Block Kit** — build the question card blocks (header / warm-up section / card / closer context for boolean; header / section / card with numbered choice layout / context for choice). For boolean questions, the card body SHALL include "👍 TRUE • 👎 FALSE" with 👍 listed before 👎. For choice questions, the numbered-emoji prefix (1️⃣ … 4️⃣) in the card body SHALL match the stored `choices` array order so the bot's automatic reactions align with each option's index.
10. **Post via `post_questions(game: "{game}", items: [{ questionId, blocks }])`** — the tool resolves the channel from game config and derives the reactions from the stored question's type, so the prompt does NOT instruct Claude to specify a channel or a `reactions` list.
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

#### Scenario: Prompt enforces the difficulty gate

- **WHEN** the prompt content is inspected
- **THEN** the returned text contains an explicit rule that questions rated ≤ 3/10 MUST be rejected and regenerated
- **AND** spells out the bucket-to-1–10 mapping (Easy = 4–6, Medium = 7–8, Hard = 9–10)

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
