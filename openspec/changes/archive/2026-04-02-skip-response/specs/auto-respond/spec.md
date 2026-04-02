## MODIFIED Requirements

### Requirement: Auto-Respond Trigger Type

The system SHALL support `"autoRespond"` as a trigger type throughout the processing pipeline, with early-exit handling in functions that index into trigger-specific config.

#### Scenario: TriggerType union includes autoRespond
- **WHEN** the system defines the `TriggerType` type
- **THEN** it includes `"autoRespond"` as a valid value

#### Scenario: Changes Workflow disabled for autoRespond
- **WHEN** the trigger type is `"autoRespond"`
- **THEN** the Changes Workflow is NOT available for the session
- **AND** Claude does NOT receive change proposal tools
- **AND** `isChangesEnabledForTrigger()` SHALL return `false` before attempting to access `config[triggerType]` (since `"autoRespond"` is not a key of the Config object)

#### Scenario: Response posted as thread reply
- **WHEN** the trigger type is `"autoRespond"`
- **AND** Claude calls `submit_response`
- **THEN** the response is posted as a thread reply on the triggering message

#### Scenario: Delivery context for auto-respond
- **WHEN** the system builds the delivery context prompt for a session with triggerType `"autoRespond"` or `"threadReply"`
- **THEN** the prompt SHALL indicate this is an automated response to a channel message
- **AND** the prompt SHALL NOT include `accept`, `reject`, or `send_to_thread` action guidance
- **AND** the prompt SHALL include guidance that Claude can use `skip_response` when the conversation doesn't need a Clack response (e.g., users talking to each other, question already answered)

#### Scenario: Extra context injected into response
- **WHEN** a matched rule has an `extraContext` field
- **THEN** the extra context is prepended to the message text sent to `processMessage()`

#### Scenario: Auto-respond sessions are not cancellable
- **WHEN** an auto-respond session is in progress
- **THEN** it is NOT registered in the in-flight request tracker
- **AND** it cannot be cancelled by editing or deleting the triggering message

#### Scenario: Skipped auto-respond leaves no trace
- **WHEN** Claude skips a response in an auto-respond session
- **THEN** the streamer message is deleted from the channel thread
- **AND** no session is persisted
- **AND** from the user's perspective, Clack never responded
