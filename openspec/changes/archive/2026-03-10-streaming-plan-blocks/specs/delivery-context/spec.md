## MODIFIED Requirements

### Requirement: Delivery Context in Claude Prompt
Include delivery context in user prompt derived from session's persisted state. The ephemeral mode is removed. Reaction triggers now have DM or Thread modes.

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
Include delivery-mode-specific guidance in Claude's instructions. Updated to reflect removal of ephemeral mode and accept/reject/refine actions.

#### Scenario: Instructions describe available actions per mode
- **WHEN** building delivery context for Claude's prompt
- **THEN** only actions relevant to the delivery mode are listed (DM reaction: `send_to_thread`; all others: no delivery-specific actions)

#### Scenario: Instructions are descriptive not prescriptive
- **WHEN** delivery context is included in the prompt
- **THEN** it describes what actions are available, not which ones Claude must use

## REMOVED Requirements

### Requirement: Delivery Context in AskClaudeOptions
**Reason**: This requirement specified deriving delivery context from session state rather than explicit flags. The mechanism remains but the specific fields change — `isEphemeral` is removed from `SessionContext`. This is an implementation detail that doesn't need a separate requirement; it's covered by the prompt requirement above.
**Migration**: Remove `isEphemeral` from session persistence. The delivery context logic reads `triggerType` and `dmChannel` presence instead.
