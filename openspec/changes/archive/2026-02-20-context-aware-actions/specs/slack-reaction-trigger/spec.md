## MODIFIED Requirements

### Requirement: Ephemeral Response Delivery
The system SHALL post initial responses as ephemeral messages visible only to the user who triggered the reaction, when the effective response type is `"ephemeral"`.

#### Scenario: Response delivered as ephemeral
- **WHEN** Claude Code generates an answer
- **AND** the user's effective response type is `"ephemeral"`
- **THEN** the system posts an ephemeral message in the thread of the original message
- **AND** only the user who added the trigger reaction can see the message
- **AND** the system renders Claude's actions as-is (Claude is responsible for including accept, reject, and refine actions based on delivery context)

#### Scenario: Silent generation
- **WHEN** answer generation is initiated from a reaction trigger
- **AND** the user's effective response type is `"ephemeral"`
- **THEN** the system generates the answer without posting a progress indicator
- **AND** posts the ephemeral response only when the answer is ready

#### Scenario: Progress indicator on Refine/Update
- **WHEN** user clicks Refine (after modal submission) or Update
- **AND** the user's effective response type is `"ephemeral"`
- **THEN** the system posts an ephemeral "thinking" indicator
- **AND** replaces it with the new response when ready

#### Scenario: DM delivery when configured
- **WHEN** Claude Code generates an answer
- **AND** the user's effective response type is `"directMessage"`
- **THEN** the system delegates to the DM-first response delivery flow
- **AND** does NOT post an ephemeral message

## REMOVED Requirements

### Requirement: Server-Side Ephemeral Action Enforcement
**Reason**: Replaced by delivery-context-aware Claude instructions. Claude now receives delivery context and is responsible for including the correct actions. The `ensureEphemeralActions()` server-side enforcement is no longer needed.
**Migration**: Remove `ensureEphemeralActions()` from `blocks.ts` and all call sites in `core.ts` and `handlerResponse.ts`.
