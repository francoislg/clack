## MODIFIED Requirements

### Requirement: Direct Message Handling
The system SHALL respond to direct messages sent to the bot, and SHALL register in-flight requests for cancellation support.

#### Scenario: User sends DM to bot
- **WHEN** a user sends a direct message to the bot
- **THEN** the system creates a new session for the message
- **AND** registers the request in the in-flight registry with an `AbortController`
- **AND** posts a visible "Investigating..." message
- **AND** updates the message with Claude's response when ready
- **AND** deregisters from the in-flight registry on completion

#### Scenario: DM in existing thread
- **WHEN** a user sends a message in an existing DM thread with the bot
- **THEN** the system continues the existing session
- **AND** registers the request in the in-flight registry with an `AbortController`
- **AND** posts a visible "Investigating..." reply
- **AND** updates the reply with Claude's response
- **AND** deregisters from the in-flight registry on completion

### Requirement: Channel Mention Handling
The system SHALL respond when @mentioned in a channel, and SHALL register in-flight requests for cancellation support.

#### Scenario: User mentions bot in channel
- **WHEN** a user @mentions the bot in a channel message
- **THEN** the system creates a new session for the message
- **AND** registers the request in the in-flight registry with an `AbortController`
- **AND** posts a visible "Investigating..." reply in a thread
- **AND** updates the reply with Claude's response when ready
- **AND** deregisters from the in-flight registry on completion
