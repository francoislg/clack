# trivia-judge-instructions Specification

## Purpose
TBD - created by archiving change trivia-judge-evaluate. Update Purpose after archive.
## Requirements
### Requirement: Cascading judgeInstructions Axis

The trivia plugin SHALL support a `judgeInstructions` configuration axis: an OPTIONAL non-empty trimmed string settable on every cascade tier (`seasonSlot`, `seasonPhase`, `season`, `gameSlot`, `game`, workspace). It SHALL be a member of `CascadeAxes` registered in `AXIS_REGISTRY` and resolved only through `resolveCascade`. Resolution SHALL be CUMULATIVE: every non-empty tier is concatenated broadest-first, each segment tier-labeled, with the same labels, separators, and length bounds as `additionalInstructions`. When no tier sets it, the resolved value SHALL be absent.

#### Scenario: No tier sets the axis

- **WHEN** no tier specifies `judgeInstructions`
- **THEN** `resolveCascade("judgeInstructions", ctx)` returns no value

#### Scenario: Tiers stack

- **WHEN** the game sets `judgeInstructions: "Accept French or English."` and the active season sets `judgeInstructions: "Riddles: metaphorical solves count."`
- **THEN** the resolved value contains both segments, the game segment before the season segment, each tier-labeled

#### Scenario: Empty value rejected

- **WHEN** a tier specifies `judgeInstructions` as a string that is empty after trimming
- **THEN** config validation returns an error naming the field
- **AND** the value is not applied

### Requirement: judgeInstructions Resolved at Reveal

`judgeInstructions` SHALL NOT be stamped on the question record. Reveal processing SHALL resolve it per freeform question from the live cascade, built from the question's own stamped season, slot, and phase, in both default and reprocess mode, and pass it to the freeform judge.

#### Scenario: Edit before reveal applies

- **WHEN** a freeform question is posted, the season's `judgeInstructions` is then changed, and the question is revealed
- **THEN** the judge receives the changed instructions

#### Scenario: Reprocess uses current instructions

- **WHEN** an already-revealed freeform question is reprocessed after a `judgeInstructions` change
- **THEN** every retained answer is re-judged with the current instructions

#### Scenario: Resolution follows the question's stamped season

- **WHEN** a question stamped with season A is revealed while season B is active
- **THEN** the judge receives season A's `judgeInstructions` tier, not season B's

#### Scenario: Resolution follows the question's stamped phase

- **WHEN** a question stamped with season A and phase `ramp` is revealed while a different phase is active
- **THEN** the judge receives phase `ramp`'s `judgeInstructions` segment, not the active phase's

#### Scenario: Slot-tier value applies to its own slot only

- **WHEN** one reveal batch holds questions from slots 0 and 2, and only slot 2 sets `judgeInstructions`
- **THEN** the judge receives the slot-2 segment for the slot-2 question and not for the slot-0 question

### Requirement: judgeInstructions in the Judge Prompt

When the resolved `judgeInstructions` is present, the freeform judge prompt SHALL carry it under a labeled heading alongside the question, and the system prompt SHALL state its authority. Under the `evaluate` preset the instructions MAY widen or narrow what counts as a correct answer. Under `strict`, `strict-with-typos`, and `lenient` they SHALL only refine accepted forms and SHALL NOT override the expected answer. Under every preset they SHALL NOT disable the universal integrity rules or the output format. When absent, the prompt SHALL be identical to a prompt built without the axis.

#### Scenario: Instructions present under evaluate

- **WHEN** the prompt is built for an `evaluate` question with resolved `judgeInstructions`
- **THEN** the prompt contains the instructions text
- **AND** states that they may widen or narrow what counts as a fit

#### Scenario: Instructions present under a key-match preset

- **WHEN** the prompt is built for a `lenient` question with resolved `judgeInstructions`
- **THEN** the prompt contains the instructions text
- **AND** states that they never override the expected answer

#### Scenario: Instructions absent

- **WHEN** the prompt is built with no resolved `judgeInstructions`
- **THEN** it contains no judge-instructions heading

### Requirement: judgeInstructions MCP Read/Write Surface

`upsert_game`, `upsert_season` (including its slot and phase tiers), and `set_workspace_config` SHALL each accept an OPTIONAL `judgeInstructions` argument, applying it to their tier and clearing it when passed null. `list_games`, `list_seasons`, and `explain_cascade` SHALL surface it. The argument descriptions SHALL state that it is the only free-text channel that reaches the freeform judge, and the `additionalInstructions` descriptions SHALL state that `additionalInstructions` does not reach the judge.

#### Scenario: Set and read back at the season tier

- **WHEN** an admin calls `upsert_season` with `judgeInstructions: "Metaphorical solves count."`
- **THEN** the season carries the value
- **AND** `list_seasons` surfaces it on that season

#### Scenario: Clear a tier

- **WHEN** an admin calls `upsert_game` with `judgeInstructions: null` on a game that had a value
- **THEN** the game no longer carries `judgeInstructions`

#### Scenario: explain_cascade shows the ladder

- **WHEN** an admin calls `explain_cascade` for a game with `judgeInstructions` set at the workspace and season tiers
- **THEN** the result shows both contributing tiers and the merged value

