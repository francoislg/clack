## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register tools based solely on the user's role and workflow configuration. Active change state is prompt context, not a tool gating mechanism.

#### Scenario: Member user tool set

- **WHEN** the user has the member role in query mode
- **THEN** the tool server registers query tools (`list_repositories`, `git_log`, `deepen_history`) and `submit_response`
- **AND** registers `find_user` and `upload_file` if a Slack client is available in the context
- **AND** does NOT register change action tools (`propose_change`, `propose_config_update`)

#### Scenario: Dev user tool set

- **GIVEN** the changes workflow is enabled for the trigger type
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server registers all query tools, `propose_change`, and `submit_response`
- **AND** registers these tools regardless of whether the thread has an active change

#### Scenario: Dev user query tools include find_pull_requests

- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server registers `find_pull_requests` alongside `find_sessions` and `find_changes`

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
