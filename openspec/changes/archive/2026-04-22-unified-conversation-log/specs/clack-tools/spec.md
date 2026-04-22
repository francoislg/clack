## ADDED Requirements

### Requirement: find_session_transcript Tool Registration

The system SHALL register the `find_session_transcript` tool in the query tool set, available to all user roles, paired with `find_recent_interactions` to enable full-transcript retrieval after a listing call.

#### Scenario: Tool available to all roles

- **WHEN** `buildQueryTools` assembles the tool list
- **THEN** `find_session_transcript` is included regardless of the user's role (member, dev, admin, owner)

#### Scenario: Tool not available in worker mode

- **WHEN** `buildWorkerTools` assembles the tool list
- **THEN** `find_session_transcript` is NOT included (worker mode has no need for session transcripts)

#### Scenario: Tool visibility in tool-name validator

- **WHEN** the tool-name validator compiles the registry
- **THEN** `find_session_transcript` is included as a known query tool name
