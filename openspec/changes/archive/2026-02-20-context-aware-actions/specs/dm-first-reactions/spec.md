## MODIFIED Requirements

### Requirement: DM Response Delivery
The system SHALL deliver reaction-triggered answers via direct message when the effective response type for the user is `"directMessage"`.

#### Scenario: Initial DM with investigation notice
- **WHEN** a user adds the trigger reaction and their effective response type is `"directMessage"`
- **THEN** the system opens a DM conversation with the user via `conversations.open`
- **AND** posts a message: "Looking into this message: <permalink>. I'll reply here when ready."
- **AND** does NOT add any thinking emoji to the original message
- **AND** does NOT post any ephemeral message in the channel

#### Scenario: Answer delivered in DM thread
- **WHEN** Claude Code generates the answer
- **THEN** the system posts the answer as a thread reply to the investigation notice DM
- **AND** renders Claude's actions as buttons (Claude is responsible for including `send_to_thread` and `reject` actions)
- **AND** the message mentions that the user can reply in the thread to refine, or click "Send to thread" to share

#### Scenario: Effective response type resolution
- **WHEN** determining the response type for a user
- **THEN** the system checks `reactions.responseType` config value
- **AND** if `"directMessage"`, checks user preferences for opt-out
- **AND** if user has opted out, falls back to `"ephemeral"`
- **AND** if config is `"ephemeral"`, always uses ephemeral regardless of user preferences
