# user-roles Delta Specification (admin-set-role change)

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Admin Management

**Reason**: Replaced by the unified `setRole` function. `addAdmin`/`removeAdmin` are replaced by `setRole(userId, "admin")` and `setRole(userId, "member")` or `setRole(userId, "dev")`.

**Migration**: Call `setRole(userId, "admin")` instead of `addAdmin(userId)`. Call `setRole(userId, "member")` instead of `removeAdmin(userId)`.

### Requirement: Dev Management

**Reason**: Replaced by the unified `setRole` function. `addDev`/`removeDev` are replaced by `setRole(userId, "dev")` and `setRole(userId, "member")`.

**Migration**: Call `setRole(userId, "dev")` instead of `addDev(userId)`. Call `setRole(userId, "member")` instead of `removeDev(userId)`.
