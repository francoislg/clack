# user-roles Specification

## Purpose
TBD - created by archiving change add-user-roles. Update Purpose after archive.
## Requirements
### Requirement: Role Storage

The system SHALL persist user roles in `data/state/roles.json`.

#### Scenario: Load roles from file
- **GIVEN** roles.json exists with valid data
- **WHEN** the system starts or needs role information
- **THEN** it loads and parses the roles from the file
- **AND** caches the roles in memory for performance

#### Scenario: Handle missing roles file
- **GIVEN** roles.json does not exist
- **WHEN** roles are queried
- **THEN** the system returns an unclaimed state (no owner)
- **AND** does not throw an error

#### Scenario: Save roles to file
- **WHEN** a role change is made
- **THEN** the system writes the updated roles to roles.json
- **AND** ensures the data/state directory exists

### Requirement: Role Hierarchy

The system SHALL support three role types with a defined hierarchy.

#### Scenario: Role types
- **WHEN** querying user roles
- **THEN** the system recognizes: owner, admin, dev, and member (default)
- **AND** owner is implicitly an admin

#### Scenario: Check owner status
- **GIVEN** a user ID
- **WHEN** checking if user is owner
- **THEN** return true only if user matches the owner field

#### Scenario: Check admin status
- **GIVEN** a user ID
- **WHEN** checking if user is admin
- **THEN** return true if user is owner OR in admins array

#### Scenario: Check dev status
- **GIVEN** a user ID
- **WHEN** checking if user is dev
- **THEN** return true if user is owner OR admin OR in devs array

### Requirement: Ownership Management

The system SHALL allow ownership to be claimed and transferred with appropriate safeguards.

#### Scenario: Claim ownership (unclaimed)
- **GIVEN** no owner exists in roles.json
- **WHEN** a user attempts to claim ownership
- **THEN** the user becomes the owner
- **AND** roles.json is updated

#### Scenario: Transfer ownership
- **GIVEN** the current user is the owner
- **AND** the target user is not disabled
- **WHEN** owner initiates transfer to target user
- **THEN** target becomes the new owner
- **AND** previous owner becomes an admin
- **AND** roles.json is updated

#### Scenario: Block transfer to disabled user
- **GIVEN** the current user is the owner
- **AND** the target user is disabled in Slack
- **WHEN** owner attempts to transfer
- **THEN** the transfer is blocked
- **AND** an error message is shown

#### Scenario: Claim ownership (disabled owner)
- **GIVEN** an owner exists but is disabled in Slack
- **AND** the current user is an admin
- **WHEN** admin attempts to claim ownership
- **THEN** the admin becomes the new owner
- **AND** previous owner is removed from all roles

### Requirement: Unified Role Assignment

The system SHALL provide a single `setRole` function that sets a user's role with automatic cascading based on the role hierarchy.

#### Scenario: Set role to admin
- **WHEN** `setRole(userId, "admin")` is called
- **AND** the user is not the owner
- **THEN** the user is added to the admins list (if not already present)
- **AND** the user is removed from the devs list (if present)
- **AND** returns `{ success: true }`

#### Scenario: Set role to dev
- **WHEN** `setRole(userId, "dev")` is called
- **AND** the user is not the owner
- **THEN** the user is added to the devs list (if not already present)
- **AND** the user is removed from the admins list (if present)
- **AND** returns `{ success: true }`

#### Scenario: Set role to member
- **WHEN** `setRole(userId, "member")` is called
- **AND** the user is not the owner
- **THEN** the user is removed from both admins and devs lists
- **AND** returns `{ success: true }`

#### Scenario: Idempotent assignment
- **WHEN** `setRole(userId, role)` is called
- **AND** the user already has the target role
- **THEN** returns `{ success: true }` without making changes

#### Scenario: Reject role change for owner
- **WHEN** `setRole(userId, role)` is called
- **AND** the user is the owner
- **THEN** returns `{ success: false, error: "..." }` indicating the owner's role cannot be changed

### Requirement: Disabled User Detection

The system SHALL detect disabled Slack users for ownership management.

#### Scenario: Check if user is disabled
- **GIVEN** a Slack user ID
- **WHEN** checking user status via Slack API
- **THEN** call users.info API
- **AND** return true if user.deleted is true

#### Scenario: Handle API errors gracefully
- **GIVEN** the Slack API call fails
- **WHEN** checking user status
- **THEN** assume user is not disabled
- **AND** log the error

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

