## ADDED Requirements

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

## MODIFIED Requirements

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
