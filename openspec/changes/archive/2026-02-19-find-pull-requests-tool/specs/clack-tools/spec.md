## ADDED Requirements

### Requirement: find_pull_requests Query Tool

The system SHALL provide a `find_pull_requests` query tool that queries GitHub for open pull requests on a repository.

#### Scenario: Query open PRs for a repository

- **WHEN** Claude calls `find_pull_requests` with a required `repo` parameter
- **THEN** the tool queries the GitHub API for open pull requests on that repository
- **AND** returns an array of PR summaries (url, title, branch, state, updatedAt)
- **AND** only queries repositories the user has read access to

#### Scenario: Filter PRs by branch name

- **WHEN** Claude calls `find_pull_requests` with an optional `branch` parameter
- **THEN** the tool filters results to PRs whose head branch contains the given string (partial match)

#### Scenario: Repository not found

- **WHEN** Claude calls `find_pull_requests` with a repo name not in configuration
- **THEN** the tool returns an error listing available repositories

#### Scenario: Repository not visible to user

- **WHEN** Claude calls `find_pull_requests` targeting a repo the user cannot read
- **THEN** the tool returns an error indicating the repo is not accessible

## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register tools based on the user's role and current context.

#### Scenario: Member user tool set

- **WHEN** the user has the member role
- **THEN** the tool server registers query tools (`list_repositories`) and `submit_response`
- **AND** does NOT register action tools (`propose_change`, `propose_config_update`)

#### Scenario: Dev user tool set

- **GIVEN** the changes workflow is enabled for the trigger type
- **WHEN** the user has the dev role (or higher)
- **THEN** the tool server registers all query tools, `propose_change`, and `submit_response`

#### Scenario: Dev user query tools include find_pull_requests

- **WHEN** the user has the dev role (or higher)
- **THEN** the tool server registers `find_pull_requests` alongside `find_sessions` and `find_changes`

#### Scenario: Dev user in change thread

- **GIVEN** the current thread has an active change session with a PR
- **WHEN** the user has the dev role (or higher)
- **THEN** the tool server additionally registers `request_review`, `request_merge`, `request_update`, and `request_close`

#### Scenario: Admin user tool set

- **GIVEN** the user has the admin or owner role
- **WHEN** the tool server is built
- **THEN** it additionally registers `propose_config_update`

#### Scenario: Dev instructions include auto-execute guidance

- **GIVEN** the user has the dev role (or higher)
- **WHEN** Claude receives dev instructions
- **THEN** the instructions include guidance on when to use `auto: true` on ref-based actions
- **AND** Claude uses `auto: true` for clear directives and omits it for ambiguous intent

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

#### Scenario: find_pull_requests tool
- **WHEN** Claude calls `find_pull_requests` with required `repo` and optional `branch` filter
- **THEN** the tool queries GitHub for open PRs on that repository
- **AND** returns PR summaries only for repositories the user can read
- **AND** PRs for invisible repositories are not queryable

#### Scenario: list_config_files tool
- **WHEN** Claude calls `list_config_files`
- **THEN** the tool returns the list of known instruction files with filename and status (customized, default, or not created)
