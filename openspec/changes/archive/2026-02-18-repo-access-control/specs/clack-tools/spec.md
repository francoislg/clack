## MODIFIED Requirements

### Requirement: Query Tools

The system SHALL provide read-only query tools for discovering system state.

#### Scenario: list_repositories tool
- **WHEN** Claude calls `list_repositories`
- **THEN** the tool returns only repositories the current user has read access to
- **AND** each entry includes name, description, and whether the user has write access
- **AND** repositories below the user's read threshold are omitted entirely

#### Scenario: find_sessions tool
- **WHEN** Claude calls `find_sessions` with optional filters (status, repo, branch)
- **THEN** the tool returns matching change sessions only for repositories the user can read
- **AND** sessions for invisible repositories are omitted

#### Scenario: find_changes tool
- **WHEN** Claude calls `find_changes` with optional filters (repo, status)
- **THEN** the tool returns active change requests only for repositories the user can read
- **AND** changes for invisible repositories are omitted

#### Scenario: list_config_files tool
- **WHEN** Claude calls `list_config_files`
- **THEN** the tool returns the list of known instruction files with filename and status (customized, default, or not created)

### Requirement: Action Tools

The system SHALL provide action tools that validate intent and return staged references.

#### Scenario: propose_change tool validates and stages
- **WHEN** Claude calls `propose_change` with branch, description, and repo
- **THEN** the tool validates: branch follows `clack/{type}/{name}` convention, repo exists in configuration, user has write access to the repo
- **AND** checks for existing worktrees on the same branch
- **AND** on success, stages the intent and returns a ref ID
- **AND** on failure, returns an error message Claude can use to retry

#### Scenario: propose_change rejects insufficient write access
- **GIVEN** a user's role is below the repo's `access.write` threshold
- **WHEN** Claude calls `propose_change` targeting that repo
- **THEN** the tool returns an error indicating the user does not have write access to this repository

#### Scenario: propose_change detects existing worktree
- **GIVEN** a worktree already exists for the specified branch and repo
- **WHEN** Claude calls `propose_change`
- **THEN** the tool returns the existing worktree info (branch, status, last activity) alongside the ref ID
- **AND** Claude can present a choice to the user: resume existing or start fresh

### Requirement: Tool Context

The system SHALL define a typed context object passed to the per-query tool builder.

#### Scenario: Context includes user identity and role
- **WHEN** the tool builder is called
- **THEN** the context includes the user's Slack ID and resolved role (member, dev, admin, owner)

#### Scenario: Context includes session state
- **WHEN** the tool builder is called
- **THEN** the context includes the current session (Q&A session or change thread session)
- **AND** includes whether the current thread has an active change session with a PR

#### Scenario: Context includes filtered repositories
- **WHEN** the tool builder is called
- **THEN** the context includes only repositories the user has read access to
- **AND** tools operate on this filtered list, not the full config
