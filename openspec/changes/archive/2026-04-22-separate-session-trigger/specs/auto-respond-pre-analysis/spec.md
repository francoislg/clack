## ADDED Requirements

### Requirement: Pre-Analysis Persistence on Session

The system SHALL persist every autoRespond pre-analysis verdict that leads to a Claude call onto the session file, so post-hoc debugging can see the gate's decisions without correlating against stdout logs.

#### Scenario: Session-creating autoRespond verdict on trigger

- **WHEN** an autoRespond pre-analysis verdict is `"respond"` and the system creates a new session
- **THEN** the verdict text is written to `trigger.preAnalysis` on that session's `context.json`
- **AND** the trigger's `type` is `"autoRespond"`

#### Scenario: Continuation verdict on assistant message

- **WHEN** a thread-reply pre-analysis verdict is `"respond"` for an existing session
- **AND** the resulting Claude turn produces an assistant message (whether delivered, skipped, or errored)
- **THEN** the verdict text is written as `preAnalysis` on the appended `SessionAssistantMessage`

#### Scenario: Skipped sessions are not persisted

- **WHEN** a pre-analysis verdict is `"skip"` (or anything other than `"respond"`) and no Claude call is made
- **THEN** no session file is created (for brand-new sessions)
- **AND** no assistant message is appended (for existing sessions)
- **AND** the verdict is NOT written to disk — the skip decision stays in stdout logs only

#### Scenario: Stop verdict captured on disengagement

- **WHEN** a pre-analysis verdict is `"stop"` on a thread reply of an existing session
- **THEN** `autoResponseActive` is set to `false` on the session
- **AND** the verdict is NOT recorded on a new assistant message (no Claude call was made)
- **AND** the stop decision stays in stdout logs only

#### Scenario: Non-autoRespond sessions carry no preAnalysis field

- **WHEN** a session's trigger type is `"reactions"`, `"mentions"`, `"directMessages"`, or `"scheduled"` (excluding scheduled jobs that use `skipConditions`)
- **THEN** the `trigger.preAnalysis` field is absent
- **AND** appended `SessionAssistantMessage` entries do NOT carry `preAnalysis`
