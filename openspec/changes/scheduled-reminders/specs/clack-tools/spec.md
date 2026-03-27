## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register tools based solely on the user's role, workflow configuration, and feature flags. Active change state is prompt context, not a tool gating mechanism.

#### Scenario: Member user tool set

- **WHEN** the user has the member role in query mode
- **THEN** the tool server registers query tools (`list_repositories`, `git_log`, `deepen_history`) and `submit_response`
- **AND** registers `find_user` and `upload_file` if a Slack client is available in the context
- **AND** registers `schedule_reminder`, `list_reminders`, and `cancel_reminder` if `allowScheduledMessages` is enabled and a Slack client is available
- **AND** does NOT register change action tools (`propose_change`, `propose_config_update`)

#### Scenario: Dev user tool set

- **GIVEN** the changes workflow is enabled for the trigger type
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server registers all query tools, `propose_change`, and `submit_response`
- **AND** registers scheduled message tools if `allowScheduledMessages` is enabled and a Slack client is available
- **AND** registers these tools regardless of whether the thread has an active change

#### Scenario: Admin user tool set

- **GIVEN** the user has the admin or owner role
- **WHEN** the tool server is built in query mode
- **THEN** it additionally registers `propose_config_update`, `list_config_files`, and `read_config_file`
- **AND** registers scheduled message tools if `allowScheduledMessages` is enabled and a Slack client is available

#### Scenario: Worker mode tool set

- **WHEN** the tool server is built with mode `"worker"`
- **THEN** it registers `git_push`, `ensure_pr`, `merge_pr`, `close_pr`, and `report_status`
- **AND** does NOT register query, action, presentation, or scheduled message tools
