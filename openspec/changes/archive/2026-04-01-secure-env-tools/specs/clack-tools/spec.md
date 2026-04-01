# clack-tools Delta Specification (secure-env-tools change)

## ADDED Requirements

### Requirement: Admin Env Tool Registration

The system SHALL register admin env tools (`admin_set_env`, `admin_list_env`) for users with admin or owner role.

#### Scenario: Admin env tools registered for admin users
- **WHEN** the tool server is built in query mode
- **AND** the user has admin or owner role
- **THEN** `admin_set_env` and `admin_list_env` are registered

#### Scenario: Admin env tools not registered for non-admin users
- **WHEN** the tool server is built in query mode
- **AND** the user has member or dev role
- **THEN** `admin_set_env` and `admin_list_env` are NOT registered

## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register tools based solely on the user's role, workflow configuration, and feature flags. Active change state is prompt context, not a tool gating mechanism.

#### Scenario: Member user tool set

- **WHEN** the user has the member role in query mode
- **THEN** the tool server registers query tools (`list_repositories`, `git_log`, `deepen_history`, `find_sessions`, `find_changes`, `find_pull_requests`, `resolve_review_thread`) and `submit_response`
- **AND** registers `find_user`, `find_emoji`, and `upload_file` if a Slack client is available in the context
- **AND** registers `schedule_reminder`, `list_reminders`, and `cancel_reminder` if `allowScheduledMessages` is enabled and a Slack client is available
- **AND** does NOT register change action tools (`propose_change`, `propose_config_update`)
- **AND** does NOT register admin config tools (`admin_read_file`, `admin_write_file`, `admin_restart_app`)
- **AND** does NOT register admin env tools (`admin_set_env`, `admin_list_env`)

#### Scenario: Dev user tool set

- **GIVEN** the changes workflow is enabled for the trigger type
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server registers all query tools, `propose_change`, and `submit_response`
- **AND** registers scheduled message tools if `allowScheduledMessages` is enabled and a Slack client is available
- **AND** registers these tools regardless of whether the thread has an active change
- **AND** does NOT register admin config tools (`admin_read_file`, `admin_write_file`, `admin_restart_app`)
- **AND** does NOT register admin env tools (`admin_set_env`, `admin_list_env`)

#### Scenario: Admin user tool set

- **GIVEN** the user has the admin or owner role
- **WHEN** the tool server is built in query mode
- **THEN** it additionally registers `propose_config_update`, `list_config_files`, and `read_config_file`
- **AND** registers `admin_read_file`, `admin_write_file`, and `admin_restart_app`
- **AND** registers `admin_set_env` and `admin_list_env`
- **AND** registers scheduled message tools if `allowScheduledMessages` is enabled and a Slack client is available

#### Scenario: Dev instructions include auto-execute guidance

- **GIVEN** the user has the dev role (or higher)
- **WHEN** Claude receives dev instructions
- **THEN** the instructions include guidance on when to use `auto: true` on ref-based actions
- **AND** Claude uses `auto: true` for clear directives and omits it for ambiguous intent

#### Scenario: Worker mode tool set

- **WHEN** the tool server is built with mode `"worker"`
- **THEN** it registers `git_push`, `ensure_pr`, `merge_pr`, `close_pr`, and `report_status`
- **AND** does NOT register query, action, presentation, scheduled message, admin config, or admin env tools
