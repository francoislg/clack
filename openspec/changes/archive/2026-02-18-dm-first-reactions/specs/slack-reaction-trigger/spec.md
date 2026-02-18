## MODIFIED Requirements

### Requirement: Ephemeral Response Delivery
The system SHALL post initial responses as ephemeral messages visible only to the user who triggered the reaction, when the effective response type is `"ephemeral"`.

#### Scenario: Response delivered as ephemeral
- **WHEN** Claude Code generates an answer
- **AND** the user's effective response type is `"ephemeral"`
- **THEN** the system posts an ephemeral message in the thread of the original message
- **AND** only the user who added the trigger reaction can see the message
- **AND** the message includes Accept, Reject, Refine, and Update action buttons

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

## ADDED Requirements

### Requirement: Response Type Configuration
The system SHALL support a configurable response type for reaction-triggered answers.

#### Scenario: Config field
- **WHEN** the system reads `reactions.responseType` from config
- **THEN** it accepts `"ephemeral"` or `"directMessage"`
- **AND** defaults to `"ephemeral"` if not specified

#### Scenario: Response type routing
- **WHEN** a reaction trigger generates an answer
- **THEN** the system resolves the effective response type for the user
- **AND** routes to the appropriate delivery method (ephemeral or DM-first)
