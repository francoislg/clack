## ADDED Requirements

### Requirement: Context Recovery Guidance in DM and Mention Prompts
The system SHALL include guidance in the DM and mention delivery context sections instructing Claude to call `find_recent_interactions` when the user references something Clack may have previously said or sent.

#### Scenario: DM trigger — context recovery hint
- **WHEN** delivery context is built for a `directMessages` trigger
- **THEN** the context includes an instruction that if the user references something Clack previously said or sent, or if Clack is unsure what the user is referring to, it SHOULD call `find_recent_interactions` before responding

#### Scenario: Mention trigger — context recovery hint
- **WHEN** delivery context is built for a `mentions` trigger
- **THEN** the context includes the same context recovery instruction as DM mode

#### Scenario: Hint is scoped — not applied to all triggers
- **WHEN** delivery context is built for `reactions`, `autoRespond`, `threadReply`, or `scheduled` triggers
- **THEN** the context recovery hint is NOT included (these triggers already have thread context)
