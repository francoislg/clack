# admin-role-tool Specification

## Purpose
MCP tool for admins to set user roles via conversation, using the role hierarchy to cascade changes automatically.

## Requirements

### Requirement: admin_set_role Tool

The system SHALL provide an `admin_set_role` tool that sets a user's role with automatic cascading.

#### Scenario: Promote user to admin
- **WHEN** Claude calls `admin_set_role` with `user` (Slack user ID) and `role` set to `"admin"`
- **THEN** the user is added to the admins list
- **AND** the user is removed from the devs list if present
- **AND** returns confirmation with the user's new role

#### Scenario: Set user to dev
- **WHEN** Claude calls `admin_set_role` with `role` set to `"dev"`
- **THEN** the user is added to the devs list
- **AND** the user is removed from the admins list if present
- **AND** returns confirmation with the user's new role

#### Scenario: Demote user to member
- **WHEN** Claude calls `admin_set_role` with `role` set to `"member"`
- **THEN** the user is removed from both admins and devs lists
- **AND** returns confirmation with the user's new role

#### Scenario: Idempotent --- user already at target role
- **WHEN** Claude calls `admin_set_role` with a role the user already has
- **THEN** returns success (no error, no-op)

#### Scenario: Reject setting role for owner
- **WHEN** Claude calls `admin_set_role` targeting the owner user
- **THEN** the tool returns an error indicating the owner's role cannot be changed via this tool

#### Scenario: Tool role gating
- **WHEN** the tool server is built for a user with admin or owner role
- **THEN** `admin_set_role` is registered
- **WHEN** the tool server is built for a user with member or dev role
- **THEN** `admin_set_role` is NOT registered
