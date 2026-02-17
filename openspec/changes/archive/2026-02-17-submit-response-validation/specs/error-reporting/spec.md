## ADDED Requirements

### Requirement: Block Posting Retry on Invalid Blocks

The system SHALL retry Claude when the Slack API rejects blocks with `invalid_blocks` despite passing local validation.

#### Scenario: Handler catches invalid_blocks error

- **WHEN** the handler posts rendered blocks to Slack
- **AND** the Slack API returns an `invalid_blocks` error
- **THEN** the system injects the error details as a refinement into the session
- **AND** re-invokes `askClaude()` so Claude can fix and resubmit via `submit_response`

#### Scenario: Retry limit enforced

- **WHEN** the handler has already retried the maximum number of times (1 retry)
- **AND** the Slack API returns `invalid_blocks` again
- **THEN** the system does NOT retry further
- **AND** falls back to posting the plain text answer without blocks

#### Scenario: Retry applies to all posting paths

- **WHEN** an `invalid_blocks` error occurs
- **THEN** the retry behavior applies to the initial response flow (core.ts) and all button handler response flows (handlerResponse.ts)

### Requirement: Plain Text Fallback on Exhausted Retries

The system SHALL fall back to plain text when block posting fails after retries are exhausted.

#### Scenario: Fallback posts plain text

- **WHEN** block retries are exhausted
- **THEN** the system posts the response as plain text (no blocks) using the answer text
- **AND** the message is delivered to the user (not lost)

#### Scenario: Fallback preserves response style

- **WHEN** the fallback posts plain text
- **THEN** it respects the original response style (ephemeral for reactions, regular for DMs/mentions)
