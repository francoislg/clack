# delivery-context Specification

## Purpose
Pass delivery context (isEphemeral, triggerType, isDmFirst) to Claude so it can make informed decisions about which actions to include in responses.

## Requirements

### Requirement: Delivery Context in Claude Prompt
The system SHALL include delivery context in the user prompt passed to Claude, so Claude can make informed decisions about which actions to include.

#### Scenario: Ephemeral reaction trigger
- **WHEN** the trigger type is `"reactions"` and the response is ephemeral
- **THEN** the prompt includes a `DELIVERY CONTEXT` block indicating `isEphemeral: true`, `triggerType: reactions`
- **AND** Claude uses this to determine that accept, reject, and refine actions are required

#### Scenario: DM-first reaction trigger
- **WHEN** the trigger type is `"reactions"` and the delivery mode is DM-first
- **THEN** the prompt includes a `DELIVERY CONTEXT` block indicating `isDmFirst: true`, `triggerType: reactions`
- **AND** Claude uses this to determine that `send_to_thread` and reject actions are appropriate

#### Scenario: Direct message trigger
- **WHEN** the trigger type is `"directMessages"`
- **THEN** the prompt includes a `DELIVERY CONTEXT` block indicating `isEphemeral: false`, `triggerType: directMessages`
- **AND** Claude uses this to determine that accept/reject are not needed (message is already delivered)

#### Scenario: Mention trigger
- **WHEN** the trigger type is `"mentions"`
- **THEN** the prompt includes a `DELIVERY CONTEXT` block indicating `isEphemeral: false`, `triggerType: mentions`
- **AND** Claude uses this to determine that accept/reject are not needed (message is already public)

### Requirement: Delivery Context in AskClaudeOptions
The system SHALL accept delivery context fields in `AskClaudeOptions` and propagate them to the prompt builder.

#### Scenario: Options passed from processMessage
- **WHEN** `processMessage` calls `askClaude`
- **THEN** `AskClaudeOptions` includes `isEphemeral`, `triggerType`, and `isDmFirst` fields
- **AND** these are derived from the processing context

#### Scenario: Options passed from button handlers
- **WHEN** a button handler (refine, choice, followup) re-invokes Claude
- **THEN** `AskClaudeOptions` includes delivery context restored from `SessionInfo`
- **AND** the delivery context matches the original invocation's context

### Requirement: Delivery-Context-Aware Instructions
The system SHALL include delivery-mode-specific guidance in Claude's instructions for the `submit_response` tool.

#### Scenario: Instructions describe ephemeral action requirements
- **WHEN** Claude reads its instructions
- **THEN** the instructions specify that ephemeral responses MUST include `accept`, `reject`, and `refine` actions
- **AND** explain that these control visibility (accept publishes, reject dismisses)

#### Scenario: Instructions describe DM-first action requirements
- **WHEN** Claude reads its instructions
- **THEN** the instructions specify that DM-first responses SHOULD include `send_to_thread` and `reject` actions
- **AND** explain that `send_to_thread` triggers synthesis and posting to the original channel thread

#### Scenario: Instructions describe non-ephemeral guidance
- **WHEN** Claude reads its instructions
- **THEN** the instructions specify that DM and mention responses SHALL NOT include `accept` or `reject` actions
- **AND** explain that the message is already delivered and these buttons would be meaningless
