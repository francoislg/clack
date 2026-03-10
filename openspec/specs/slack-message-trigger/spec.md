# slack-message-trigger Specification

## Purpose
TBD - created by archiving change add-message-mode. Update Purpose after archive.
## Requirements
### Requirement: Message Mode Configuration
The system SHALL support enabling/disabling message mode via configuration.

#### Scenario: Message mode disabled by default
- **WHEN** `directMessages.enabled` is not set in configuration
- **THEN** the system does not listen for DMs or @mentions
- **AND** defaults to disabled

#### Scenario: Message mode enabled
- **WHEN** `directMessages.enabled` is set to `true`
- **THEN** the system registers handlers for DMs and @mentions
- **AND** responds to direct messages and channel mentions

### Requirement: Direct Message Handling
The system SHALL handle direct messages via the Bolt Assistant API, processing user messages through the standard query flow with streaming delivery.

#### Scenario: User sends message in assistant thread
- **WHEN** a user sends a message in an assistant thread
- **THEN** the system processes it via the Assistant's `userMessage` handler
- **AND** calls `setStatus()` for thinking indication
- **AND** routes to `processMessage` with `triggerType: "directMessages"`
- **AND** starts a chat stream with plan blocks showing tool progress
- **AND** stops the stream with the final response blocks on completion

#### Scenario: Follow-up in assistant thread
- **WHEN** a user sends a follow-up message in an existing assistant thread
- **THEN** the system continues the existing session
- **AND** processes the message with full conversation history
- **AND** starts a new chat stream for the reply with plan blocks

### Requirement: Channel Mention Handling
The system SHALL respond when @mentioned in a channel, and SHALL register in-flight requests for cancellation support. Channel mentions now use streaming instead of posting and updating an "Investigating..." message.

#### Scenario: User mentions bot in channel
- **WHEN** a user @mentions the bot in a channel message
- **THEN** the system creates or continues a session
- **AND** starts a chat stream in the thread with plan blocks showing tool progress
- **AND** stops the stream with the final response blocks on completion

#### Scenario: Thread reply in channel
- **WHEN** a user posts in a thread started by a bot @mention
- **THEN** the system continues the existing session
- **AND** starts a new chat stream for the reply with plan blocks

### Requirement: Visible Response Updates
Responses are delivered via streaming, not by posting a placeholder and updating it.

#### Scenario: Response message lifecycle
- **WHEN** processing a message mode query
- **THEN** the system starts a chat stream with live tool progress (task cards)
- **AND** finalizes the stream with the complete response on completion
- **AND** does NOT post a separate "Investigating..." placeholder message
