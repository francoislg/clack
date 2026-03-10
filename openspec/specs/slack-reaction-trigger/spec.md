# slack-reaction-trigger Specification

## Purpose
TBD - created by archiving change add-slack-reaction-bot. Update Purpose after archive.
## Requirements
### Requirement: Reaction Detection
The system SHALL listen for configurable emoji reactions and initiate answer generation. When a matching reaction is detected, the system SHALL start a streaming response in the target determined by user preference (DM channel or channel thread).

#### Scenario: Trigger reaction added
- **WHEN** a user adds the configured trigger emoji to a message
- **THEN** the system starts a streaming response targeted at the user's preferred delivery mode (DM or thread)

#### Scenario: Work-mode reaction added
- **WHEN** a user with dev+ role adds the configured work-mode emoji to a message
- **THEN** the system starts a streaming response with `workMode: true` in the user's preferred delivery mode

#### Scenario: Non-trigger reaction ignored
- **WHEN** a user adds an emoji that does not match any configured trigger
- **THEN** no processing occurs

#### Scenario: Bot not in channel
- **WHEN** the bot lacks access to the channel where the reaction was added
- **THEN** the system silently ignores the reaction (no error posted)

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

### Requirement: Thread Context Reading
The system SHALL include thread context when generating answers for messages in threads.

#### Scenario: Question in thread includes parent context
- **WHEN** the trigger reaction is added to a message that is a thread reply
- **THEN** the system includes the parent message and preceding thread replies as context
- **AND** passes this context to Claude Code for answer generation

#### Scenario: Question on parent message includes thread
- **WHEN** the trigger reaction is added to a parent message that has thread replies
- **THEN** the system includes the thread replies as additional context

