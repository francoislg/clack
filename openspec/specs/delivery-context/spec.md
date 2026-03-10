# delivery-context Specification

## Purpose
Derive delivery context from the session's persisted state and pass it to Claude so it can make informed decisions about which actions to include in responses.

## Requirements

### Requirement: Delivery Context in Claude Prompt
The system SHALL include delivery context in the user prompt passed to Claude, derived from the session's persisted state, so Claude can make informed decisions about which actions to include in responses.

#### Scenario: DM reaction trigger
- **WHEN** session has `triggerType: "reactions"` and `dmChannel` is set
- **THEN** delivery context describes DM mode with available actions: `send_to_thread`

#### Scenario: Thread reaction trigger
- **WHEN** session has `triggerType: "reactions"` and `dmChannel` is NOT set
- **THEN** delivery context describes Thread mode (visible in channel thread) with no delivery-specific actions

#### Scenario: Direct message trigger
- **WHEN** session has `triggerType: "directMessages"`
- **THEN** delivery context describes DM mode with no delivery-specific actions (response is already visible to user)

#### Scenario: Mention trigger
- **WHEN** session has `triggerType: "mentions"`
- **THEN** delivery context describes Mention mode (visible in channel thread) with no delivery-specific actions

### Requirement: Delivery-Context-Aware Instructions
The system SHALL include delivery-mode-specific guidance in Claude's instructions for the `submit_response` tool. Updated to reflect removal of ephemeral mode and accept/reject/refine actions.

#### Scenario: Instructions describe available actions per mode
- **WHEN** building delivery context for Claude's prompt
- **THEN** only actions relevant to the delivery mode are listed (DM reaction: `send_to_thread`; all others: no delivery-specific actions)

#### Scenario: Instructions are descriptive not prescriptive
- **WHEN** delivery context is included in the prompt
- **THEN** it describes what actions are available, not which ones Claude must use
