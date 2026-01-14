# slack-message-trigger Specification

## Purpose
Handle direct messages and @mentions to the bot, providing a conversational interface with visible responses and automatic thread continuation.

## ADDED Requirements

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
The system SHALL respond to direct messages sent to the bot.

#### Scenario: User sends DM to bot
- **WHEN** a user sends a direct message to the bot
- **THEN** the system creates a new session for the message
- **AND** posts a visible "Investigating..." message
- **AND** updates the message with Claude's response when ready

#### Scenario: DM in existing thread
- **WHEN** a user sends a message in an existing DM thread with the bot
- **THEN** the system continues the existing session
- **AND** posts a visible "Investigating..." reply
- **AND** updates the reply with Claude's response

### Requirement: Channel Mention Handling
The system SHALL respond when @mentioned in a channel.

#### Scenario: User mentions bot in channel
- **WHEN** a user @mentions the bot in a channel message
- **THEN** the system creates a new session for the message
- **AND** posts a visible "Investigating..." reply in a thread
- **AND** updates the reply with Claude's response when ready

#### Scenario: Thread reply in channel
- **WHEN** a user posts in a thread started by a bot @mention
- **THEN** the system continues the existing session
- **AND** posts a visible "Investigating..." reply
- **AND** updates the reply with Claude's response

### Requirement: Visible Response Updates
The system SHALL post and update visible messages (not ephemeral) for message mode.

#### Scenario: Response message lifecycle
- **WHEN** processing a message mode query
- **THEN** the system posts a visible message with "Investigating..." text
- **AND** updates the same message with the final response
- **AND** no Accept/Reject buttons are shown (response is immediately public)

### Requirement: Thread Auto-Response
The system SHALL automatically respond to all messages in threads it participates in.

#### Scenario: Auto-respond to thread messages
- **WHEN** any user posts a message in a thread where the bot has responded
- **AND** the message is not from the bot itself
- **THEN** the system automatically processes the message
- **AND** responds in the same thread
