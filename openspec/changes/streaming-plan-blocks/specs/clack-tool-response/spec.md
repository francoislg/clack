## REMOVED Requirements

### Requirement: Terminal Action Types
**Reason**: The `accept` and `reject` action types are removed (ephemeral-only). The `edit` action type is removed (only used with ephemeral accept flow).
**Migration**: No action needed. Claude's instructions will no longer reference these action types.

### Requirement: Continuation Action Types — Refine
**Reason**: The `refine` action type is removed (ephemeral-only). `followup` and `choice` action types remain.
**Migration**: Thread-based replies replace the refine action for all delivery modes.

## MODIFIED Requirements

### Requirement: submit_response Tool — Action Types (UPDATED)

The known action type set in the `submit_response` schema is reduced.

#### Scenario: Response with actions (UPDATED)
- **WHEN** Claude calls `submit_response` with an actions array
- **THEN** each action has a `type` from the set: `followup`, `choice`, `send_to_thread`, `change`, `config_update`, `update`
- **AND** the removed types (`accept`, `reject`, `edit`, `refine`) are rejected by schema validation

### Requirement: Structured Response Rendering — Button Styles (UPDATED)

Button style mapping is updated to reflect removed types.

#### Scenario: Actions rendered as buttons (UPDATED)
- **WHEN** the response includes actions
- **THEN** button style reflects type: `change`, `merge`, and `send_to_thread` are primary, `close` is danger, others are default
- **AND** removed types (`accept`, `reject`) no longer have style mappings
