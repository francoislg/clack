## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register tools based solely on the user's role and workflow configuration. Active change state is prompt context, not a tool gating mechanism.

#### Scenario: Member user tool set

- **WHEN** the user has the member role in query mode
- **THEN** the tool server registers query tools (`list_repositories`, `git_log`, `deepen_history`) and `submit_response`
- **AND** registers `find_user` if a Slack client is available in the context
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

### Requirement: Tool Context

The system SHALL provide active change information as prompt context, not as tool gating criteria.

#### Scenario: Context includes user identity and role

- **WHEN** the tool builder is called in query mode
- **THEN** the context includes the user's Slack ID and resolved role (member, dev, admin, owner)

#### Scenario: Active change as prompt context

- **WHEN** the tool builder is called in query mode
- **AND** the thread's session has `activeChange` populated
- **THEN** the active change details (branch, repo, status, PR URL) are included in the prompt sent to Claude
- **AND** these details do NOT affect which tools are registered

#### Scenario: No active change

- **WHEN** the tool builder is called in query mode
- **AND** the thread's session has no `activeChange`
- **THEN** no active change context is included in the prompt
- **AND** the same tools are available as when an active change exists (for the same role)

#### Scenario: Context includes filtered repositories

- **WHEN** the tool builder is called in query mode
- **THEN** the context includes only repositories the user has read access to
- **AND** tools operate on this filtered list, not the full config

#### Scenario: Context includes optional Slack client

- **WHEN** the tool builder is called in query mode from a real Slack interaction
- **THEN** the context includes a Slack `WebClient` instance
- **AND** tools that require Slack API access (such as `find_user`) use this client

#### Scenario: Worker context includes worktree and session info

- **WHEN** the tool builder is called in worker mode
- **THEN** the context includes mode `"worker"`, the worktree path, branch name, repo name, and repo URL
- **AND** includes the Slack channel ID and thread timestamp (for `report_status`)
- **AND** includes the change session ID (for session state updates)
- **AND** includes the app configuration

## REMOVED Requirements

### Requirement: Change Thread Follow-Up Tools
**Reason**: The `request_review`, `request_merge`, `request_close` tools were session-bound wrappers that only worked with the active change session's PR. They are replaced by Claude using GitHub MCP tools directly for PR operations (merge, close, comment, review) on any PR the user references. Claude determines intent from the message and uses the appropriate tool — Clack's `propose_change` for worktree-based code changes, or GitHub MCP for PR operations.
**Migration**: Remove `request_review`, `request_merge`, `request_close` from query tool registration. Keep `request_update` only for requesting code changes to an existing worktree (the one action that requires Clack-specific infrastructure). Alternatively, `request_update` can also be replaced by `propose_change` detecting an existing worktree on the same branch.
