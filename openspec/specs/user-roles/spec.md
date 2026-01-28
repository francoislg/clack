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

### Requirement: Admin Management

The system SHALL allow admins and owner to manage admin roles.

#### Scenario: Add admin
- **GIVEN** the current user is owner or admin
- **AND** the target user is not already an admin
- **WHEN** admin adds target as admin
- **THEN** target is added to the admins array
- **AND** roles.json is updated

#### Scenario: Remove admin
- **GIVEN** the current user is owner or admin
- **AND** the target is an admin (not owner)
- **WHEN** admin removes target
- **THEN** target is removed from admins array
- **AND** roles.json is updated

#### Scenario: Cannot remove owner via admin removal
- **GIVEN** the target user is the owner
- **WHEN** attempting to remove them as admin
- **THEN** the action is blocked
- **AND** an error message indicates owner cannot be removed

### Requirement: Dev Management

The system SHALL allow admins to manage dev roles.

#### Scenario: Add dev
- **GIVEN** the current user is owner or admin
- **AND** the target user is not already a dev
- **WHEN** admin adds target as dev
- **THEN** target is added to the devs array
- **AND** roles.json is updated

#### Scenario: Remove dev
- **GIVEN** the current user is owner or admin
- **AND** the target is in the devs array
- **WHEN** admin removes target
- **THEN** target is removed from devs array
- **AND** roles.json is updated

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

