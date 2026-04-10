## ADDED Requirements

### Requirement: find_recent_interactions Tool Registration
The system SHALL register the `find_recent_interactions` tool in the query tool set, available to all user roles.

#### Scenario: Tool available to all roles
- **WHEN** `buildQueryTools` assembles the tool list
- **THEN** `find_recent_interactions` is included regardless of the user's role (member, dev, admin, owner)

#### Scenario: Tool not available in worker mode
- **WHEN** `buildWorkerTools` assembles the tool list
- **THEN** `find_recent_interactions` is NOT included (worker mode has no need for session history)
