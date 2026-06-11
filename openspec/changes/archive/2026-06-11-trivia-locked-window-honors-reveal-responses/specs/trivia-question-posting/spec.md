## MODIFIED Requirements

### Requirement: Live-card rebuild honors answerLocked

The live-card rebuild — the path that repaints a posted question's Slack message from its stored `postedBlocks` (used by the live answered-roster repaint and by the lock/unlock tools) — SHALL branch on the question's `answerLocked` flag:

- When `answerLocked !== true`: the rebuild composes the card as today — `[...postedBlocks, ...rosterBlocks]`, i.e. the answer-actions block (vote / freeform-answer buttons, plus any shared hint button) stays live and the live roster footer is appended. The footer's grouped-vs-flat layout is governed by the question's stamped `liveAnswersVisible`, unchanged by this requirement.
- When `answerLocked === true`: the rebuild strips the answer-actions block — identified by its `block_id` prefix (`vote-actions:` for boolean/choice, `freeform-answer-actions:` for freeform) — and appends the localized "🔒 locked in — waiting on results" context notice INSTEAD of the buttons. It then appends a roster footer below the notice whose disclosure is driven by the question's stamped `revealResponses` value (absent SHALL read as `"yes"`), NOT by `liveAnswersVisible`:
  - `"yes"`: the full grouped vote distribution — every answerer named under their pick (the same grouped layout the unlocked card uses when `liveAnswersVisible === true`).
  - `"just-correctness"` / `"just-winners"`: a flat participation roster — who answered, with NO picks revealed (the same flat layout the unlocked card uses when `liveAnswersVisible === false`). During the locked window the outcome is not yet settled, so these modes cannot partition by correctness and degrade to participation-only; full correctness/winner bucketing happens only at the actual reveal.
  - `"no"`: NO roster footer — the locked notice is the final block (today's behavior).

The locked roster SHALL apply the same cheater-row filter the unlocked roster applies — answers from flagged cheaters on that question SHALL be excluded before grouping/listing. The locked roster SHALL honor the question's stamped `tagPlayers` value the same way the unlocked roster does (`<@USERID>` mentions vs plain `@displayName`).

`liveAnswersVisible` SHALL NOT be consulted while `answerLocked === true`; it governs only the live (voting-open) phase, where its purpose is anti-bandwagoning. Once voting is frozen, `revealResponses` is the sole disclosure gate for the locked roster.

The button-stripping SHALL reuse the same block-prefix filter the reveal-card edit uses (extracted into a shared helper so both call sites agree). Because the rebuild always composes from `postedBlocks` (never the message's current Slack state), the transition is fully reversible: clearing `answerLocked` and rebuilding restores the buttons and the `liveAnswersVisible`-driven live roster with no residue.

#### Scenario: Locked rebuild drops buttons and keeps the notice

- **GIVEN** a posted question whose `postedBlocks` include a `vote-actions:<id>` block
- **AND** the record has `answerLocked: true`
- **WHEN** the card is rebuilt
- **THEN** the `vote-actions:<id>` block is absent from the rebuilt message
- **AND** the rebuilt message includes the localized locked notice context block

#### Scenario: Locked window with revealResponses "yes" shows the full grouped distribution

- **GIVEN** a locked question stamped `revealResponses: "yes"` with several recorded answers across multiple picks
- **WHEN** the card is rebuilt
- **THEN** below the locked notice the rebuild appends a roster footer naming every answerer grouped under their pick
- **AND** this holds regardless of the question's stamped `liveAnswersVisible` value

#### Scenario: Locked window with revealResponses just-correctness shows participation only

- **GIVEN** a locked question stamped `revealResponses: "just-correctness"` with several recorded answers
- **WHEN** the card is rebuilt
- **THEN** below the locked notice the rebuild appends a flat participation roster listing who answered
- **AND** no answerer's pick is disclosed

#### Scenario: Locked window with revealResponses just-winners shows participation only

- **GIVEN** a locked question stamped `revealResponses: "just-winners"` with several recorded answers
- **WHEN** the card is rebuilt
- **THEN** below the locked notice the rebuild appends a flat participation roster listing who answered
- **AND** no answerer's pick is disclosed

#### Scenario: Locked window with revealResponses "no" shows the notice alone

- **GIVEN** a locked question stamped `revealResponses: "no"` with several recorded answers
- **WHEN** the card is rebuilt
- **THEN** the rebuilt message ends with the localized locked notice context block
- **AND** no roster footer is appended

#### Scenario: Absent revealResponses on a locked question reads as "yes"

- **GIVEN** a locked legacy question record with no `revealResponses` field and several recorded answers
- **WHEN** the card is rebuilt
- **THEN** the rebuild appends the full grouped vote distribution below the locked notice (the `"yes"` behavior)

#### Scenario: Cheater rows are excluded from the locked roster

- **GIVEN** a locked question stamped `revealResponses: "yes"` where one answerer is a flagged cheater on that question
- **WHEN** the card is rebuilt
- **THEN** the flagged cheater does not appear in the locked roster footer

#### Scenario: Unlocked rebuild is unchanged

- **GIVEN** a posted question with no `answerLocked` (or `answerLocked: false`)
- **WHEN** the card is rebuilt on a new vote
- **THEN** the composition is `[...postedBlocks, ...rosterBlocks]` exactly as before this change
- **AND** the answer buttons remain present
- **AND** the roster footer layout follows the stamped `liveAnswersVisible`

#### Scenario: Unlock restores buttons and the liveAnswersVisible roster

- **GIVEN** a question previously rebuilt with `answerLocked: true` (buttons stripped, locked roster shown)
- **WHEN** `answerLocked` is cleared and the card is rebuilt
- **THEN** the answer-actions block from `postedBlocks` is present again
- **AND** the locked notice is absent
- **AND** the live roster footer follows the stamped `liveAnswersVisible`
