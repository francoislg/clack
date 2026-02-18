# repo-access-control Specification

## Purpose
Centralized repository access control using role-based read/write thresholds on each repository configuration. Provides functions for checking and filtering repository visibility and change permissions based on user roles.

## Requirements
### Requirement: Repository Access Configuration

The system SHALL support an optional `access` property on each repository config with `read` and `write` role thresholds.

#### Scenario: Default access when omitted
- **WHEN** a repository config omits the `access` property
- **THEN** the repository is visible to all roles (read threshold: member)
- **AND** no changes can be proposed (read-only)

#### Scenario: Read threshold
- **GIVEN** a repository config has `access.read` set to a role (e.g., "dev")
- **WHEN** a user with a lower role queries the system
- **THEN** the repository is invisible to that user across all surfaces
- **AND** users with the specified role or higher can see the repository

#### Scenario: Write threshold
- **GIVEN** a repository config has `access.write` set to a role (e.g., "admin")
- **WHEN** a user with a lower role attempts to propose a change
- **THEN** the change is rejected
- **AND** users with the specified role or higher can propose changes

#### Scenario: Write implies change support
- **GIVEN** a repository config has `access.write` defined
- **THEN** the repository supports the changes workflow
- **AND** `supportsChanges` is derived as `true`

#### Scenario: No write means read-only
- **GIVEN** a repository config omits `access.write`
- **THEN** the repository does not support changes
- **AND** no user can propose changes to it regardless of role

### Requirement: Centralized Access Checks

The system SHALL provide centralized functions for repository access decisions in a dedicated module.

#### Scenario: Check read access
- **WHEN** any component needs to determine if a user can see a repository
- **THEN** it calls `canReadRepo(role, repo)` from the repo access module
- **AND** the function compares the user's role level against the repo's read threshold

#### Scenario: Check write access
- **WHEN** any component needs to determine if a user can propose changes to a repository
- **THEN** it calls `canWriteRepo(role, repo)` from the repo access module
- **AND** the function checks that `access.write` is defined AND the user's role meets the threshold

#### Scenario: Filter visible repositories
- **WHEN** any component needs the list of repositories a user can see
- **THEN** it calls `getVisibleRepos(role, repos)` which returns only repos where `canReadRepo` is true

#### Scenario: Filter writable repositories
- **WHEN** any component needs the list of repositories a user can change
- **THEN** it calls `getWritableRepos(role, repos)` which returns only repos where `canWriteRepo` is true

### Requirement: Role Level Comparison

The system SHALL compare roles using a numeric hierarchy for threshold checks.

#### Scenario: Role hierarchy levels
- **WHEN** comparing roles for access decisions
- **THEN** the system uses numeric levels: member=0, dev=1, admin=2, owner=3
- **AND** a user meets a threshold when their level is greater than or equal to the required level

### Requirement: Config Validation for Access

The system SHALL validate the `access` property during config loading.

#### Scenario: Valid access config
- **GIVEN** a repository config has `access: { "read": "dev", "write": "admin" }`
- **WHEN** the config is validated
- **THEN** validation succeeds

#### Scenario: Invalid role in access
- **GIVEN** a repository config has `access: { "read": "superuser" }`
- **WHEN** the config is validated
- **THEN** validation fails with a descriptive error message

#### Scenario: Reject legacy supportsChanges
- **GIVEN** a repository config includes `supportsChanges`
- **WHEN** the config is validated
- **THEN** validation fails with an error explaining migration to `access.write`
