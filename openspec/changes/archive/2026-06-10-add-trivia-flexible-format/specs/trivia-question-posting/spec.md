## MODIFIED Requirements

### Requirement: POST_QUESTIONS_INSTRUCTIONS queries the staged pool before generating

The POST_QUESTIONS_INSTRUCTIONS prompt (used by the question cron when `game.prepCron` is set) SHALL begin with a staged-pool check before any per-slot generation:

1. Call `find_previous_questions({ games: ["<game>"], seasons: ["current"], posted: false, match: "all" })` to retrieve any staged questions.
2. Inspect the active format (slot count, per-slot labels, and the `flexible` flag) via a `get_ideas({ slot: 0 })` call.
3. For each slot index in `[0..slotCount-1]`, in order:
   - If at least one staged question matches `slot.index === i`, select the oldest by `createdAt`.
   - If no staged question matches, run the per-slot generation flow inline (FACT/CHOICE/TOPICAL/FREEFORM matrix as rolled by `get_ideas` for that slot) and persist via `save_question`.
   - **When the resolved format is `flexible`**, a slot that yields no usable question (neither staged nor generable with good material) SHALL terminate the prefix: the loop stops at that index and lower-numbered filled slots become the fire's output. When the format is NOT flexible, every slot MUST be filled (inline-generated if not staged).
4. Once the slots to post are determined — every slot for a fixed format, or the filled prefix for a flexible format — assemble the message blocks (opener if first-fire-of-season, per-question card built from question data + persona-driven flair, closer) and call `post_questions({ items })` with the items in slot order. When a flexible fire determines zero slots to post, it SHALL call `post_questions` zero times and terminate with `submit_response({ skip_response: true })`.

When `prepCron` is configured but prep didn't run (or partially ran), the staged pool returns fewer questions than the format's slot count and the inline-gen branch covers the missing slots (for a fixed format) or fills as far as material allows (for a flexible format). When `prepCron` is NOT configured, the game uses the legacy `SEND_QUESTIONS_INSTRUCTIONS` prompt directly — see the routing requirement above; the same flexible prefix behavior applies there.

#### Scenario: Question cron with complete staged pool

- **GIVEN** the staged pool contains questions for slots 0, 1, 2 of a 3-slot fixed format
- **WHEN** the question cron fires and Claude runs the POST prompt
- **THEN** Claude reads the staged pool and finds all 3 slots filled
- **AND** Claude calls `save_question` zero times (no inline gen needed)
- **AND** Claude assembles the message blocks from the staged questions' data
- **AND** Claude calls `post_questions({ items: [item0, item1, item2] })` with items in slot order

#### Scenario: Question cron with partial staged pool

- **GIVEN** the staged pool contains questions for slots 0 and 2 (slot 1 missing)
- **AND** the active format has 3 slots and is NOT flexible
- **WHEN** the question cron fires
- **THEN** Claude reads the pool and identifies slot 1 as missing
- **AND** Claude calls `get_ideas({ slot: 1 })` and runs the full per-slot generation flow for slot 1
- **AND** Claude calls `save_question` for the new slot 1 question
- **AND** Claude calls `post_questions({ items: [staged-0, fresh-1, staged-2] })` with all three items in slot order

#### Scenario: Question cron with empty staged pool (prep configured but didn't run)

- **GIVEN** `game.prepCron` is set
- **AND** the staged pool is empty (prep failed earlier, or this is the very first fire)
- **AND** the active format is NOT flexible
- **WHEN** the question cron fires running POST_QUESTIONS_INSTRUCTIONS
- **THEN** Claude reads zero staged questions from the pool
- **AND** Claude inline-generates every slot in the format
- **AND** Claude calls `post_questions` with one item per slot

#### Scenario: Flexible format fills a prefix and stops early

- **GIVEN** the active format has 3 slots and `flexible: true`
- **AND** the staged pool is empty
- **AND** usable material exists for slots 0 and 1 but not slot 2
- **WHEN** the question cron fires running POST_QUESTIONS_INSTRUCTIONS
- **THEN** Claude inline-generates and saves questions for slots 0 and 1
- **AND** Claude stops at slot 2 (no usable question) without filling it
- **AND** Claude calls `post_questions({ items: [item0, item1] })` with two items in slot order

#### Scenario: Flexible format with no material posts nothing

- **GIVEN** the active format has `flexible: true`
- **AND** no usable material exists for slot 0 and the staged pool is empty
- **WHEN** the question cron fires running POST_QUESTIONS_INSTRUCTIONS
- **THEN** Claude calls `post_questions` zero times
- **AND** Claude terminates the run with `submit_response({ skip_response: true })`
