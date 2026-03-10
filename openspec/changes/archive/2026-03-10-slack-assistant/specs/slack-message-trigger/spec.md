## MODIFIED Requirements

### Requirement: Direct Message Handling
The system SHALL handle direct messages via the Bolt Assistant API, processing user messages through the standard query flow.

#### Scenario: User sends message in assistant thread
- **WHEN** a user sends a message in an assistant thread
- **THEN** the system processes it via the Assistant's `userMessage` handler
- **AND** routes to `processMessage` with `triggerType: "directMessages"`
- **AND** uses `setStatus()` for thinking indication

#### Scenario: Follow-up in assistant thread
- **WHEN** a user sends a follow-up message in an existing assistant thread
- **THEN** the system continues the existing session
- **AND** processes the message with full conversation history

## REMOVED Requirements

### Requirement: Thread Auto-Response (raw message.im handler)
**Reason**: Replaced by the Assistant's built-in `userMessage` handler which automatically handles all messages in assistant threads.
**Migration**: No action needed — the Assistant handles this natively.

## UNCHANGED Requirements

- DM-first reaction delivery flow (dmActions.ts, dmResponse.ts)
- DM delivery user preference (dm vs thread)
- Reaction synthesis and send_to_thread for reaction-originated sessions
- @Mention handling
