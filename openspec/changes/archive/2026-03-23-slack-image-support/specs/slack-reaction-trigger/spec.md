## MODIFIED Requirements

### Requirement: Reaction Detection

The system SHALL listen for configurable emoji reactions and initiate answer generation. When a matching reaction is detected, the system SHALL start a streaming response in the target determined by user preference (DM channel or channel thread).

#### Scenario: Trigger reaction added

- **WHEN** a user adds the configured trigger emoji to a message
- **THEN** the system starts a streaming response targeted at the user's preferred delivery mode (DM or thread)

#### Scenario: Trigger reaction on message with images

- **WHEN** a user adds the configured trigger emoji to a message containing uploaded images
- **THEN** the system extracts image file metadata from the resolved message
- **AND** passes the image metadata to `processMessage` alongside the message text

#### Scenario: Work-mode reaction added

- **WHEN** a user with dev+ role adds the configured work-mode emoji to a message
- **THEN** the system starts a streaming response with `workMode: true` in the user's preferred delivery mode

#### Scenario: Non-trigger reaction ignored

- **WHEN** a user adds an emoji that does not match any configured trigger
- **THEN** no processing occurs

#### Scenario: Bot not in channel

- **WHEN** the bot lacks access to the channel where the reaction was added
- **THEN** the system silently ignores the reaction (no error posted)

### Requirement: Thread Context Reading

The system SHALL include thread context when generating answers for messages in threads.

#### Scenario: Question in thread includes parent context

- **WHEN** the trigger reaction is added to a message that is a thread reply
- **THEN** the system includes the parent message and preceding thread replies as context
- **AND** passes this context to Claude Code for answer generation

#### Scenario: Question on parent message includes thread

- **WHEN** the trigger reaction is added to a parent message that has thread replies
- **THEN** the system includes the thread replies as additional context

#### Scenario: Thread context includes image metadata

- **WHEN** thread context is fetched for a reaction trigger
- **AND** any thread message contains uploaded images
- **THEN** the thread context messages include image file metadata for those messages
