## ADDED Requirements

### Requirement: Live-card rebuild honors answerLocked

The live-card rebuild — the path that repaints a posted question's Slack message from its stored `postedBlocks` (used by the live answered-roster repaint and by the lock/unlock tools) — SHALL branch on the question's `answerLocked` flag:

- When `answerLocked !== true`: the rebuild composes the card as today — `[...postedBlocks, ...rosterBlocks]`, i.e. the answer-actions block (vote / freeform-answer buttons, plus any shared hint button) stays live and the live roster footer is appended.
- When `answerLocked === true`: the rebuild strips the answer-actions block — identified by its `block_id` prefix (`vote-actions:` for boolean/choice, `freeform-answer-actions:` for freeform) — and appends a single localized "🔒 locked in — waiting on results" context notice INSTEAD of the buttons and INSTEAD of the live roster footer.

The button-stripping SHALL reuse the same block-prefix filter the reveal-card edit uses (extracted into a shared helper so both call sites agree). Because the rebuild always composes from `postedBlocks` (never the message's current Slack state), the transition is fully reversible: clearing `answerLocked` and rebuilding restores the buttons and roster with no residue.

#### Scenario: Locked rebuild drops buttons and shows the notice

- **GIVEN** a posted question whose `postedBlocks` include a `vote-actions:<id>` block
- **AND** the record has `answerLocked: true`
- **WHEN** the card is rebuilt
- **THEN** the `vote-actions:<id>` block is absent from the rebuilt message
- **AND** the rebuilt message ends with the localized locked notice context block
- **AND** no live roster footer is appended

#### Scenario: Unlocked rebuild is unchanged

- **GIVEN** a posted question with no `answerLocked` (or `answerLocked: false`)
- **WHEN** the card is rebuilt on a new vote
- **THEN** the composition is `[...postedBlocks, ...rosterBlocks]` exactly as before this change
- **AND** the answer buttons remain present

#### Scenario: Unlock restores buttons from postedBlocks

- **GIVEN** a question previously rebuilt with `answerLocked: true` (buttons stripped, notice shown)
- **WHEN** `answerLocked` is cleared and the card is rebuilt
- **THEN** the answer-actions block from `postedBlocks` is present again
- **AND** the locked notice is absent
