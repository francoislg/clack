## ADDED Requirements

### Requirement: Auto-Execute Permission Gating

The system SHALL only auto-execute ref-based actions for users with the dev role or higher.

#### Scenario: Privileged user auto-execute proceeds

- **GIVEN** a user with dev, admin, or owner role
- **WHEN** a response contains an action with `auto: true`
- **THEN** the system auto-executes the action immediately after posting the response

#### Scenario: Non-privileged user auto-execute blocked

- **GIVEN** a user with the member role
- **WHEN** a response contains an action with `auto: true`
- **THEN** the system does NOT auto-execute the action
- **AND** the action renders as a button (but the button handler also checks permissions)

#### Scenario: Role defaults to member when unset

- **WHEN** the role is not provided to the auto-execute handler
- **THEN** the system defaults to `"member"` and does NOT auto-execute
