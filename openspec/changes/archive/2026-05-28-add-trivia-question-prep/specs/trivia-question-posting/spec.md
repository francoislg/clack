## ADDED Requirements

### Requirement: Question-cron prompt routing splits on prepCron

The question-cron spec emitted by `buildGameSpecs` SHALL select its prompt based on whether `game.prepCron` is set:

- When `game.prepCron` is SET, the question-cron spec's `prompt` SHALL be derived from `POST_QUESTIONS_INSTRUCTIONS` (the new prompt with the staged-pool check + inline-gen fallback + posting).
- When `game.prepCron` is ABSENT, the question-cron spec's `prompt` SHALL be derived from `SEND_QUESTIONS_INSTRUCTIONS` (the legacy gen-and-post prompt — observable behavior unchanged from before this change).

Internally, all three prompts (`SEND_`, `PREP_`, `POST_`) SHALL be composed from shared building-block constants (`PER_SLOT_GENERATION_PATHS`, `FORMAT_AND_POST_SECTION`, `CONTEXT_PRIORITY_PREAMBLE`) so that future changes to the per-slot generation flow or the posting/opener logic propagate to all three prompts automatically.

#### Scenario: Game without prepCron uses the legacy SEND prompt

- **GIVEN** a game with no `prepCron` field
- **WHEN** `buildGameSpecs` emits the question-cron spec
- **THEN** the spec's `prompt` is the legacy `SEND_QUESTIONS_INSTRUCTIONS` (with `{game}` substituted)
- **AND** the prompt does NOT contain a STAGED POOL CHECK section

#### Scenario: Game with prepCron uses the new POST prompt

- **GIVEN** a game with `prepCron` set
- **WHEN** `buildGameSpecs` emits the question-cron spec
- **THEN** the spec's `prompt` is `POST_QUESTIONS_INSTRUCTIONS` (with `{game}` substituted)
- **AND** the prompt contains a STAGED POOL CHECK section

### Requirement: POST_QUESTIONS_INSTRUCTIONS queries the staged pool before generating

The POST_QUESTIONS_INSTRUCTIONS prompt (used by the question cron when `game.prepCron` is set) SHALL begin with a staged-pool check before any per-slot generation:

1. Call `find_previous_questions({ games: ["<game>"], seasons: ["current"], posted: false, match: "all" })` to retrieve any staged questions.
2. Inspect the active format (slot count and per-slot labels) via a `get_ideas({ slot: 0 })` call.
3. For each slot index in `[0..slotCount-1]`:
   - If at least one staged question matches `slot.index === i`, select the oldest by `createdAt`.
   - If no staged question matches, run the per-slot generation flow inline (FACT/CHOICE/TOPICAL/FREEFORM matrix as rolled by `get_ideas` for that slot) and persist via `save_question`.
4. Once every slot has a question (staged or freshly generated), assemble the message blocks (opener if first-fire-of-season, per-question card built from question data + persona-driven flair, closer) and call `post_questions({ items })`.

When `prepCron` is configured but prep didn't run (or partially ran), the staged pool returns fewer questions than the format's slot count and the inline-gen branch covers the missing slots. When `prepCron` is NOT configured, the game uses the legacy `SEND_QUESTIONS_INSTRUCTIONS` prompt directly — see the routing requirement above.

#### Scenario: Question cron with complete staged pool

- **GIVEN** the staged pool contains questions for slots 0, 1, 2 of a 3-slot format
- **WHEN** the question cron fires and Claude runs the POST prompt
- **THEN** Claude reads the staged pool and finds all 3 slots filled
- **AND** Claude calls `save_question` zero times (no inline gen needed)
- **AND** Claude assembles the message blocks from the staged questions' data
- **AND** Claude calls `post_questions({ items: [item0, item1, item2] })` with items in slot order

#### Scenario: Question cron with partial staged pool

- **GIVEN** the staged pool contains questions for slots 0 and 2 (slot 1 missing)
- **AND** the active format has 3 slots
- **WHEN** the question cron fires
- **THEN** Claude reads the pool and identifies slot 1 as missing
- **AND** Claude calls `get_ideas({ slot: 1 })` and runs the full per-slot generation flow for slot 1
- **AND** Claude calls `save_question` for the new slot 1 question
- **AND** Claude calls `post_questions({ items: [staged-0, fresh-1, staged-2] })` with all three items in slot order

#### Scenario: Question cron with empty staged pool (prep configured but didn't run)

- **GIVEN** `game.prepCron` is set
- **AND** the staged pool is empty (prep failed earlier, or this is the very first fire)
- **WHEN** the question cron fires running POST_QUESTIONS_INSTRUCTIONS
- **THEN** Claude reads zero staged questions from the pool
- **AND** Claude inline-generates every slot in the format
- **AND** Claude calls `post_questions` with one item per slot

### Requirement: Per-question card blocks rebuild from question data at post time

For each question being posted (whether staged or freshly inline-generated), the POST prompt SHALL build the standard FOUR-BLOCK per-question card layout from the question record's stored fields — `category`, `statement`, `emojis`, plus the answer-format-specific fields (`isTrue` / `choices` / `correctIndex` / `expectedAnswer`). The block-rendering logic SHALL be identical for staged and inline-generated questions; the only difference is the source of the underlying data.

#### Scenario: Staged question renders identically to a freshly-generated one

- **GIVEN** a staged question with `{ category: "Geography", statement: "Foo is the capital of bar.", isTrue: true, emojis: ["🌍"], answersFormat: "boolean" }`
- **WHEN** Claude renders the FOUR-BLOCK card for this question at post time
- **THEN** the rendered blocks are structurally identical to those that would be rendered for the same question if generated inline at the same fire
- **AND** the persona-driven flair (header text variation, warm-up patter, closer) reflects the same constraints documented in the question-posting prompt today
