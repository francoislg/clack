## ADDED Requirements

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
