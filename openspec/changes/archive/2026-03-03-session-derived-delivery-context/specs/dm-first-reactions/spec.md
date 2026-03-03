## MODIFIED Requirements

### Requirement: DM Thread Refinement
The system SHALL support natural thread-based refinement in DM threads linked to reaction-originated sessions.

#### Scenario: User replies in DM thread
- **WHEN** a user sends a message in a DM thread that is linked to a reaction-originated session
- **THEN** the system treats the reply as a refinement instruction
- **AND** regenerates the answer incorporating the new instructions and full conversation history
- **AND** posts the updated answer as a new thread reply with action buttons derived from Claude's response

#### Scenario: Multiple refinement rounds
- **WHEN** a user sends multiple replies in the DM thread
- **THEN** each reply triggers a new refinement pass
- **AND** all prior conversation history is included in subsequent Claude queries
- **AND** Claude receives correct delivery context (derived from session state) on every refinement call
- **AND** the latest response includes action buttons appropriate to Claude's response

#### Scenario: Refinement requests a code change
- **WHEN** a user replies in the DM thread requesting a code change (e.g., "make that change")
- **THEN** Claude receives full delivery context and changes workflow capability
- **AND** Claude can include `propose_change` or other action tools as appropriate
- **AND** the response is not limited to only `send_to_thread` and `reject` actions
