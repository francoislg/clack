## MODIFIED Requirements

### Requirement: Direct Message Handling

The system SHALL handle direct messages via the Bolt Assistant API, processing user messages through the standard query flow with streaming delivery.

#### Scenario: User sends message in assistant thread

- **WHEN** a user sends a message in an assistant thread
- **THEN** the system processes it via the Assistant's `userMessage` handler
- **AND** calls `setStatus()` for thinking indication
- **AND** routes to `processMessage` with `triggerType: "directMessages"`
- **AND** starts a chat stream with plan blocks showing tool progress
- **AND** stops the stream with the final response blocks on completion

#### Scenario: User sends message with images in assistant thread

- **WHEN** a user sends a message in an assistant thread containing uploaded images
- **THEN** the system extracts image file metadata from the message event
- **AND** passes the image metadata to `processMessage` alongside the message text

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

#### Scenario: User mentions bot with images

- **WHEN** a user @mentions the bot in a channel message containing uploaded images
- **THEN** the system extracts image file metadata from the mention event
- **AND** passes the image metadata to `processMessage` alongside the cleaned message text

#### Scenario: Thread reply in channel

- **WHEN** a user posts in a thread started by a bot @mention
- **THEN** the system continues the existing session
- **AND** starts a new chat stream for the reply with plan blocks
