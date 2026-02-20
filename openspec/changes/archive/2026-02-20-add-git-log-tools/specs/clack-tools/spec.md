## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register tools based on the user's role, current context, and invocation mode.

#### Scenario: Member user tool set

- **WHEN** the user has the member role in query mode
- **THEN** the tool server registers query tools (`list_repositories`, `git_log`, `deepen_history`) and `submit_response`
- **AND** does NOT register action tools (`propose_change`, `propose_config_update`)
- **AND** does NOT register follow-up tools (`request_review`, `request_merge`, `request_update`, `request_close`)

#### Scenario: Dev user tool set

- **GIVEN** the changes workflow is enabled for the trigger type
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server registers all query tools, `propose_change`, and `submit_response`

#### Scenario: Dev user query tools include find_pull_requests

- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server registers `find_pull_requests` alongside `find_sessions` and `find_changes`

#### Scenario: Dev user in change thread

- **GIVEN** the current thread has an active change session with a PR
- **AND** the user has the dev role (or higher)
- **WHEN** the tool server is built in query mode
- **THEN** the tool server additionally registers `request_review`, `request_merge`, `request_update`, and `request_close`

#### Scenario: Member user in change thread

- **GIVEN** the current thread has an active change session
- **AND** the user has the member role
- **WHEN** the tool server is built in query mode
- **THEN** the tool server does NOT register follow-up action tools

#### Scenario: Admin user tool set

- **GIVEN** the user has the admin or owner role
- **WHEN** the tool server is built in query mode
- **THEN** it additionally registers `propose_config_update`, `list_config_files`, and `read_config_file`

#### Scenario: Dev instructions include auto-execute guidance

- **GIVEN** the user has the dev role (or higher)
- **WHEN** Claude receives dev instructions
- **THEN** the instructions include guidance on when to use `auto: true` on ref-based actions
- **AND** Claude uses `auto: true` for clear directives and omits it for ambiguous intent

#### Scenario: Worker mode tool set

- **WHEN** the tool server is built with mode `"worker"`
- **THEN** it registers `git_push`, `ensure_pr`, `merge_pr`, `close_pr`, and `report_status`
- **AND** does NOT register query, action, or presentation tools

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

#### Scenario: git_log tool
- **WHEN** Claude calls `git_log` with required `repo` and optional `args` array
- **THEN** the tool executes `git log` on the local repository clone
- **AND** returns raw output with shallow-clone metadata
- **AND** only queries repositories the user has read access to

#### Scenario: deepen_history tool
- **WHEN** Claude calls `deepen_history` with required `repo` and optional `commits` or `full` parameters
- **THEN** the tool fetches additional commit history for the local repository clone
- **AND** only operates on repositories the user has read access to

#### Scenario: list_config_files tool
- **WHEN** Claude calls `list_config_files`
- **THEN** the tool returns the list of known instruction files with filename and status (customized, default, or not created)
