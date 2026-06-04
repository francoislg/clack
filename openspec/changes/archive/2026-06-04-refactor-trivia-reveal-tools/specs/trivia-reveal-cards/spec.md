## MODIFIED Requirements

### Requirement: Static reveal edit of the original question message

The static reveal edit of a question's original Slack message SHALL be performed by the `update_answers_block` tool (`trivia-card-projection`), not by the answer-compute tool. When `update_answers_block` projects a question, it SHALL edit that question's original Slack message exactly once (`chat.update`) into a final, static state. The edit SHALL be rebuilt deterministically from the question's stored `postedBlocks` (never from the message's current Slack state) so that repeated edits cannot accumulate stale blocks. The edit is a snapshot of current file state and SHALL be re-runnable: re-projecting after `answers.json` changes reconciles the card to the new state.

The rebuilt message SHALL preserve the original card body, SHALL remove the answer-actions block, SHALL append a static results footer, and SHALL append a single "See your answer" button.

#### Scenario: Original card body is preserved

- **WHEN** a question message is edited at reveal by `update_answers_block`
- **THEN** the blocks above the answer-actions block (header, warm-up, card, closer) are unchanged from `postedBlocks`

#### Scenario: Rebuild is from postedBlocks, not current Slack state

- **WHEN** the reveal edit runs
- **THEN** the new block array is derived from the stored `postedBlocks` plus the appended results footer and button
- **AND** any live "Answered: …" roster footer or divider previously appended by live-phase edits is not carried over

#### Scenario: Legacy question without postedBlocks skips the edit

- **WHEN** `update_answers_block` projects a question that has no stored `postedBlocks`
- **THEN** the reveal edit is skipped and a warning is logged
- **AND** the rest of the batch is projected normally

#### Scenario: Message update failure is non-fatal

- **WHEN** the `chat.update` for the reveal edit fails (e.g. message deleted, rate limit)
- **THEN** the failure is logged
- **AND** `update_answers_block` continues projecting the remaining cards in the batch and still returns
