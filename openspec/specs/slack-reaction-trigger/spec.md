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

#### Scenario: Work-mode reaction added

- **WHEN** a user adds the configured work-mode reaction emoji to a message
- **THEN** the system reads the message content and thread context
- **AND** initiates answer generation via Claude Code with work-mode signal

#### Scenario: Non-trigger reaction ignored

- **WHEN** a user adds a reaction that is not the configured trigger emoji or work-mode emoji
- **THEN** the system takes no action

#### Scenario: Bot not in channel

- **WHEN** a user adds the trigger reaction in a channel where the bot is not a member
- **THEN** no action is taken (bot cannot see the event)

### Requirement: Work Mode Reaction Trigger

The system SHALL support a separate "work mode" reaction emoji that routes through the standard `processMessage` pipeline with a work-mode signal.

#### Scenario: Dev user reacts with work emoji

- **WHEN** a user with dev role (or higher) adds the configured work-mode reaction emoji to a message
- **THEN** the system calls `processMessage` with `workMode: true`
- **AND** the message is processed through the standard Claude query pipeline with MCP tools

#### Scenario: Non-dev user reacts with work emoji

- **WHEN** a user without dev role adds the configured work-mode reaction emoji to a message
- **THEN** the system calls `processMessage` without `workMode` (standard Q&A flow)
- **AND** no error or permission message is shown to the user

#### Scenario: Work mode prompt hint

- **WHEN** `processMessage` is called with `workMode: true`
- **THEN** `askClaude` prepends a work-mode hint to the user prompt
- **AND** the hint instructs Claude to propose a code change using `propose_change` with `auto: true`
- **AND** the hint tells Claude to ask for clarification via `submit_response` if the request is unclear

### Requirement: Ephemeral Response Delivery
The system SHALL post initial responses as ephemeral messages visible only to the user who triggered the reaction, when the effective response type is `"ephemeral"`.

#### Scenario: Response delivered as ephemeral
- **WHEN** Claude Code generates an answer
- **AND** the user's effective response type is `"ephemeral"`
- **THEN** the system posts an ephemeral message in the thread of the original message
- **AND** only the user who added the trigger reaction can see the message
- **AND** the system renders Claude's actions as-is (Claude is responsible for including accept, reject, and refine actions based on delivery context)

#### Scenario: Silent generation
- **WHEN** answer generation is initiated from a reaction trigger
- **AND** the user's effective response type is `"ephemeral"`
- **THEN** the system generates the answer without posting a progress indicator
- **AND** posts the ephemeral response only when the answer is ready

#### Scenario: Progress indicator on Refine/Update
- **WHEN** user clicks Refine (after modal submission) or Update
- **AND** the user's effective response type is `"ephemeral"`
- **THEN** the system posts an ephemeral "thinking" indicator
- **AND** replaces it with the new response when ready

#### Scenario: DM delivery when configured
- **WHEN** Claude Code generates an answer
- **AND** the user's effective response type is `"directMessage"`
- **THEN** the system delegates to the DM-first response delivery flow
- **AND** does NOT post an ephemeral message

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

### Requirement: Response Type Configuration
The system SHALL support a configurable response type for reaction-triggered answers.

#### Scenario: Config field
- **WHEN** the system reads `reactions.responseType` from config
- **THEN** it accepts `"ephemeral"` or `"directMessage"`
- **AND** defaults to `"ephemeral"` if not specified

#### Scenario: Response type routing
- **WHEN** a reaction trigger generates an answer
- **THEN** the system resolves the effective response type for the user
- **AND** routes to the appropriate delivery method (ephemeral or DM-first)
