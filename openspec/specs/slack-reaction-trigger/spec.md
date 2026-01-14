# slack-reaction-trigger Specification

## Purpose
TBD - created by archiving change add-slack-reaction-bot. Update Purpose after archive.
## Requirements
### Requirement: Reaction Detection
The system SHALL listen for a configurable emoji reaction on messages in Slack channels where the bot is present.

#### Scenario: Trigger reaction added
- **WHEN** a user adds the configured trigger reaction to a message
- **THEN** the system reads the message content and thread context
- **AND** initiates answer generation via Claude Code

#### Scenario: Non-trigger reaction ignored
- **WHEN** a user adds a reaction that is not the configured trigger emoji
- **THEN** the system takes no action

#### Scenario: Bot not in channel
- **WHEN** a user adds the trigger reaction in a channel where the bot is not a member
- **THEN** no action is taken (bot cannot see the event)

### Requirement: Ephemeral Response Delivery
The system SHALL post initial responses as ephemeral messages visible only to the user who triggered the reaction.

#### Scenario: Response delivered as ephemeral
- **WHEN** Claude Code generates an answer
- **THEN** the system posts an ephemeral message in the thread of the original message
- **AND** only the user who added the trigger reaction can see the message
- **AND** the message includes Accept, Reject, Refine, and Update action buttons

#### Scenario: Silent generation
- **WHEN** answer generation is initiated from a reaction trigger
- **THEN** the system generates the answer without posting a progress indicator
- **AND** posts the ephemeral response only when the answer is ready

#### Scenario: Progress indicator on Refine/Update
- **WHEN** user clicks Refine (after modal submission) or Update
- **THEN** the system posts an ephemeral "thinking" indicator
- **AND** replaces it with the new response when ready

### Requirement: Accept Action
The system SHALL make the answer visible to all channel members when the user clicks Accept.

#### Scenario: Accept publishes response
- **WHEN** user clicks the Accept button on an ephemeral response
- **THEN** the system posts the answer as a visible thread reply
- **AND** removes the ephemeral message
- **AND** resets the session timeout

### Requirement: Reject Action
The system SHALL dismiss the ephemeral response when the user clicks Reject.

#### Scenario: Reject dismisses response
- **WHEN** user clicks the Reject button on an ephemeral response
- **THEN** the system removes the ephemeral message
- **AND** no visible message is posted
- **AND** the session remains active for potential re-trigger

### Requirement: Refine Action
The system SHALL open a modal for additional instructions when the user clicks Refine.

#### Scenario: Refine opens modal
- **WHEN** user clicks the Refine button on an ephemeral response
- **THEN** the system opens a Slack modal with a text input field
- **AND** the modal is pre-populated with placeholder text for guidance

#### Scenario: Refine submission regenerates answer
- **WHEN** user submits the Refine modal with additional instructions
- **THEN** the system regenerates the answer incorporating the new instructions
- **AND** posts a new ephemeral response replacing the previous one
- **AND** resets the session timeout

### Requirement: Update Action
The system SHALL re-read the message/thread and regenerate when the user clicks Update.

#### Scenario: Update re-reads context
- **WHEN** user clicks the Update button on an ephemeral response
- **THEN** the system re-fetches the original message and any new thread replies
- **AND** regenerates the answer with the updated context
- **AND** posts a new ephemeral response replacing the previous one
- **AND** resets the session timeout

### Requirement: Thread Context Reading
The system SHALL include thread context when generating answers for messages in threads.

#### Scenario: Question in thread includes parent context
- **WHEN** the trigger reaction is added to a message that is a thread reply
- **THEN** the system includes the parent message and preceding thread replies as context
- **AND** passes this context to Claude Code for answer generation

#### Scenario: Question on parent message includes thread
- **WHEN** the trigger reaction is added to a parent message that has thread replies
- **THEN** the system includes the thread replies as additional context

