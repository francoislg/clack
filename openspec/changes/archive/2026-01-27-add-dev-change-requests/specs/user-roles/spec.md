## ADDED Requirements

### Requirement: Change Request Authorization

The system SHALL enforce role-based access for change requests.

#### Scenario: Dev role required for changes
- **GIVEN** a user sends a message that matches change request patterns
- **WHEN** the system detects a change request
- **THEN** it checks if the user has the `dev` role (or higher: admin, owner)
- **AND** proceeds with the change only if authorized

#### Scenario: Unauthorized change request
- **GIVEN** a user without the `dev` role
- **WHEN** they send a message matching change request patterns
- **THEN** the system responds with a friendly message explaining:
  - Change requests require the dev role
  - They can ask an admin to grant the role
- **AND** does not execute the change

#### Scenario: Change request from admin or owner
- **GIVEN** a user is an admin or owner
- **WHEN** they send a change request
- **THEN** the request is authorized (implicitly a dev)
- **AND** the change workflow proceeds

### Requirement: Change Request Audit

The system SHALL log change request attempts for security auditing.

#### Scenario: Log authorized change request
- **WHEN** a dev triggers a change request
- **THEN** the system logs: user ID, timestamp, request summary, target repository
- **AND** includes the log entry in debug output

#### Scenario: Log unauthorized change attempt
- **WHEN** a non-dev attempts a change request
- **THEN** the system logs: user ID, timestamp, denied reason
- **AND** includes the log entry in debug output
