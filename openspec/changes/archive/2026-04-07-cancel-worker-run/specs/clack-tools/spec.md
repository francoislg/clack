## MODIFIED Requirements

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

#### Scenario: propose_config_update tool validates and stages

- **WHEN** Claude calls `propose_config_update` with file and content
- **THEN** the tool validates: filename is in the known instruction files list, content is non-empty
- **AND** on success, stages the intent and returns a ref ID
- **AND** on failure, returns an error message Claude can use to retry

#### Scenario: Action tool retry on validation error

- **GIVEN** Claude calls an action tool with invalid parameters
- **WHEN** the tool returns an error
- **THEN** Claude receives the error message in the tool response
- **AND** Claude can call the tool again with corrected parameters

#### Scenario: cancel_worker_run registered alongside change tools

- **WHEN** the tool server is built in query mode
- **AND** the user has dev+ role and changes workflow is enabled
- **THEN** `cancel_worker_run` is registered alongside `propose_change` and `request_update`
- **AND** accepts optional `target_user_id` (admin/owner only) and optional `reason`
