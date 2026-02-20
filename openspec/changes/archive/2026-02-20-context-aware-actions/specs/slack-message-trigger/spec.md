## MODIFIED Requirements

### Requirement: Visible Response Updates
The system SHALL post and update visible messages (not ephemeral) for message mode.

#### Scenario: Response message lifecycle
- **WHEN** processing a message mode query
- **THEN** the system posts a visible message with "Investigating..." text
- **AND** updates the same message with the final response
- **AND** renders Claude's actions as-is (Claude is responsible for omitting accept/reject based on delivery context)
