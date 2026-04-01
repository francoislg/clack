# clack-tools Delta Specification (admin-set-role change)

## ADDED Requirements

### Requirement: Admin Role Tool Registration

The system SHALL register `admin_set_role` for users with admin or owner role.

#### Scenario: Admin role tool registered for admin users
- **WHEN** the tool server is built in query mode
- **AND** the user has admin or owner role
- **THEN** `admin_set_role` is registered

#### Scenario: Admin role tool not registered for non-admin users
- **WHEN** the tool server is built in query mode
- **AND** the user has member or dev role
- **THEN** `admin_set_role` is NOT registered
