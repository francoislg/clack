# delivery-context Specification

## Purpose
Derive delivery context from the session's persisted state and pass it to Claude so it can make informed decisions about which actions to include in responses.

## Requirements

### Requirement: Delivery Context in Claude Prompt
The system SHALL include delivery context in the user prompt passed to Claude, derived from the session's persisted state, so Claude can make informed decisions about which actions to include in responses.

#### Scenario: DM reaction trigger
- **WHEN** session has `triggerType: "reactions"` and `dmChannel` is set
- **THEN** delivery context describes DM mode with available actions: `post_to`

#### Scenario: Thread reaction trigger
- **WHEN** session has `triggerType: "reactions"` and `dmChannel` is NOT set
- **THEN** delivery context describes Thread mode (visible in channel thread)
- **AND** mentions that `post_to` with `auto: true` and no `thread_ts` posts as a top-level channel message when the user asks for it

#### Scenario: Direct message trigger
- **WHEN** session has `triggerType: "directMessages"`
- **THEN** delivery context describes DM mode with no delivery-specific actions (response is already visible to user)
- **AND** states that `post_to` is not available (no channel context)

#### Scenario: Mention trigger
- **WHEN** session has `triggerType: "mentions"`
- **THEN** delivery context describes Mention mode (visible in channel thread)
- **AND** mentions that `post_to` with `auto: true` and no `thread_ts` posts as a top-level channel message when the user asks for it

#### Scenario: Assistant panel trigger
- **WHEN** session has `triggerType: "directMessages"` and `assistantOriginChannelId` is set
- **THEN** delivery context describes Assistant mode
- **AND** mentions that `post_to` posts to the channel the user is viewing

#### Scenario: Auto-respond trigger
- **WHEN** session has `triggerType: "autoRespond"`
- **THEN** delivery context states that `post_to` is not available

### Requirement: Delivery-Context-Aware Instructions
The system SHALL include delivery-mode-specific guidance in Claude's instructions for the `submit_response` tool.

#### Scenario: Instructions describe available actions per mode
- **WHEN** building delivery context for Claude's prompt
- **THEN** only actions relevant to the delivery mode are listed (DM reaction: `post_to`; Thread/Mention: `post_to` for channel posting; Assistant: `post_to` for channel sharing; DM/Auto-respond: no `post_to`)

#### Scenario: Instructions are descriptive not prescriptive
- **WHEN** delivery context is included in the prompt
- **THEN** it describes what actions are available, not which ones Claude must use
