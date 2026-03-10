## MODIFIED Requirements

### Requirement: Direct Message Handling
Direct messages now use streaming instead of posting and updating an "Investigating..." message.

#### Scenario: User sends DM to bot (UPDATED)
- **WHEN** a user sends a direct message to the bot
- **THEN** the system creates or continues a session
- **AND** starts a chat stream with plan blocks showing tool progress
- **AND** stops the stream with the final response blocks on completion

#### Scenario: DM in existing thread (UPDATED)
- **WHEN** a user sends a message in an existing DM thread with the bot
- **THEN** the system continues the existing session
- **AND** starts a new chat stream for the reply with plan blocks

### Requirement: Channel Mention Handling
Channel mentions now use streaming instead of posting and updating an "Investigating..." message.

#### Scenario: User mentions bot in channel (UPDATED)
- **WHEN** a user @mentions the bot in a channel message
- **THEN** the system creates or continues a session
- **AND** starts a chat stream in the thread with plan blocks showing tool progress
- **AND** stops the stream with the final response blocks on completion

#### Scenario: Thread reply in channel (UPDATED)
- **WHEN** a user posts in a thread started by a bot @mention
- **THEN** the system continues the existing session
- **AND** starts a new chat stream for the reply with plan blocks

### Requirement: Visible Response Updates (UPDATED)
Responses are delivered via streaming, not by posting a placeholder and updating it.

#### Scenario: Response message lifecycle (UPDATED)
- **WHEN** processing a message mode query
- **THEN** the system starts a chat stream with live tool progress (task cards)
- **AND** finalizes the stream with the complete response on completion
- **AND** does NOT post a separate "Investigating..." placeholder message
