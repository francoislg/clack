## MODIFIED Requirements

### Requirement: Delivery Context in Claude Prompt
The system SHALL include delivery context in the user prompt passed to Claude, derived from the session's persisted state, so Claude can make informed decisions about which actions to include in responses.

#### Scenario: DM-first reaction trigger
- **WHEN** the session has `dmChannel` and `originChannel` set
- **THEN** the prompt includes a `DELIVERY CONTEXT` block indicating DM-first mode
- **AND** the prompt lists available actions (`send_to_thread`, `reject`) without mandating them
- **AND** if `channelPostTs` is set, the prompt notes that an answer has already been shared to the channel

#### Scenario: Ephemeral reaction trigger
- **WHEN** the session has `triggerType` of `"reactions"` and `isEphemeral` is `true`
- **THEN** the prompt includes a `DELIVERY CONTEXT` block indicating ephemeral mode
- **AND** the prompt lists available actions (`accept`, `reject`, `refine`) as required for ephemeral visibility control

#### Scenario: Direct message trigger
- **WHEN** the session has `triggerType` of `"directMessages"`
- **THEN** the prompt includes a `DELIVERY CONTEXT` block indicating DM mode
- **AND** the prompt states that `accept`/`reject` actions have no meaning in this context

#### Scenario: Mention trigger
- **WHEN** the session has `triggerType` of `"mentions"`
- **THEN** the prompt includes a `DELIVERY CONTEXT` block indicating mention mode
- **AND** the prompt states that `accept`/`reject` actions have no meaning in this context

### Requirement: Delivery Context in AskClaudeOptions
The system SHALL derive delivery context from `SessionContext` fields rather than from explicit `AskClaudeOptions` flags.

#### Scenario: Session-derived context replaces option flags
- **WHEN** `askClaude` is called with a `SessionContext`
- **THEN** `buildDeliveryContext` reads `triggerType`, `isEphemeral`, `dmChannel`, and `originChannel` from the session
- **AND** `AskClaudeOptions` no longer contains `isDmFirst`, `isEphemeral`, or `triggerType` fields

#### Scenario: Call sites pass session only
- **WHEN** any call site (processMessage, processDmRefinement, button handlers) invokes `askClaude`
- **THEN** delivery context is derived automatically from the session
- **AND** the call site does not need to reconstruct delivery flags

### Requirement: Delivery-Context-Aware Instructions
The system SHALL include delivery-mode-specific guidance in Claude's instructions for the `submit_response` tool.

#### Scenario: Instructions describe available actions per mode
- **WHEN** Claude reads its delivery context
- **THEN** the context lists which actions are available in the current mode
- **AND** Claude chooses appropriate actions based on the user's request and the available action set

#### Scenario: Instructions are descriptive not prescriptive
- **WHEN** the delivery context is built for DM-first or ephemeral mode
- **THEN** the prompt describes the delivery situation and lists available actions
- **AND** does not mandate a fixed set of actions for every response
