## MODIFIED Requirements

### Requirement: Work Mode Reaction Trigger

The system SHALL support a separate "work mode" reaction emoji that adds a prompt hint biasing Claude toward proposing changes, gated by user permissions.

#### Scenario: Dev user reacts with work emoji

- **WHEN** a user with dev role (or higher) adds the configured work-mode reaction emoji to a message
- **THEN** the system calls `processMessage` with `workMode: true`
- **AND** the message is processed through the standard Claude query pipeline with all tools available for the user's role

#### Scenario: Non-dev user reacts with work emoji

- **WHEN** a user without dev role adds the configured work-mode reaction emoji to a message
- **THEN** the system calls `processMessage` without `workMode` (standard Q&A flow)
- **AND** no error or permission message is shown to the user

#### Scenario: Work mode as prompt hint

- **WHEN** `processMessage` is called with `workMode: true`
- **THEN** `askClaude` prepends a work-mode hint to the user prompt
- **AND** the hint biases Claude toward proposing a code change using `propose_change` with `auto: true`
- **AND** the hint tells Claude to ask for clarification via `submit_response` if the request is unclear
- **AND** the hint does NOT change which tools are registered (tool availability is based on role and session state)
