## ADDED Requirements

### Requirement: `process_reveal_answers` payload carries resolved `instructions` and `additionalInstructions`

The `process_reveal_answers` MCP tool SHALL invoke the `resolveInstructions` and `resolveAdditionalInstructions` resolvers (defined in `trivia-prompt-instructions`) against the active game, the current season (if any), and the appropriate slot tier (when the question's slot index is known). The resolved string values SHALL be attached to the top-level `ProcessRevealResult` as optional fields `instructions?: string` and `additionalInstructions?: string`. Each field SHALL be present iff the corresponding resolver returns a non-null value; absent results SHALL omit the field entirely (NOT serialize as `null`).

#### Scenario: Both axes resolve to non-null values

- **WHEN** the tool runs against a game whose season + workspace set both axes
- **THEN** the returned `ProcessRevealResult` SHALL include both `instructions` and `additionalInstructions` string fields

#### Scenario: Only one axis resolves

- **WHEN** `instructions` resolves to a non-null value but `additionalInstructions` resolves to null
- **THEN** the returned `ProcessRevealResult` SHALL include `instructions` and SHALL omit `additionalInstructions`

#### Scenario: Neither axis resolves

- **WHEN** no tier carries either axis
- **THEN** the returned `ProcessRevealResult` SHALL omit both fields entirely

#### Scenario: Slot tier resolution for multi-question batches

- **WHEN** the reveal batch contains multiple questions with different slot indices and slot-tier `additionalInstructions` is set on some slots but not others
- **THEN** the tool SHALL use the union of all relevant slot-tier values when concatenating `additionalInstructions` for the batch; the implementation MAY pick any deterministic strategy (e.g. the first slot's index, or every slot in order) so long as the chosen strategy is documented in code and consistent across calls
