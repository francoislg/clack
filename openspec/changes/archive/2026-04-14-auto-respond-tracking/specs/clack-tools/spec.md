## ADDED Requirements

### Requirement: stop_tracking Query Tool

The system SHALL provide a `stop_tracking` query tool that deactivates auto-respond tracking for a thread identified by a Slack message URL.

#### Scenario: Tool registered when Slack client available

- **WHEN** the tool server is built in query mode
- **AND** a Slack client is available in the context
- **THEN** the `stop_tracking` tool is registered for all roles

#### Scenario: Tool not registered in worker mode

- **WHEN** the tool server is built in worker mode
- **THEN** the `stop_tracking` tool is NOT registered

#### Scenario: Stop tracking by URL

- **WHEN** Claude calls `stop_tracking` with a `url` parameter containing a valid Slack message URL
- **THEN** the tool parses the URL to extract channel ID and thread timestamp
- **AND** calls `findSessionByThread(channelId, threadTs)` to locate the session
- **AND** sets `autoResponseActive = false` on the session
- **AND** persists the updated session to disk
- **AND** returns `{ success: true, channel: channelId, thread_ts: threadTs, session_id: sessionId }`

#### Scenario: No session found

- **WHEN** Claude calls `stop_tracking` with a URL that does not correspond to a tracked thread
- **THEN** the tool returns an error: `"No tracked session found for that thread"`

#### Scenario: Invalid URL format

- **WHEN** Claude calls `stop_tracking` with a URL that does not match the Slack message URL pattern
- **THEN** the tool returns an error indicating invalid URL format

#### Scenario: Permission denied for non-admin

- **WHEN** a user calls `stop_tracking` targeting a session they did not create
- **AND** the user does not have admin or owner role
- **THEN** the tool returns an error: `"You can only stop tracking threads you started, or ask an admin"`

#### Scenario: Admin can stop any thread

- **WHEN** a user with admin or owner role calls `stop_tracking`
- **THEN** the tool sets `autoResponseActive = false` regardless of who created the session

#### Scenario: Tool not registered without Slack client

- **WHEN** the tool server is built in query mode
- **AND** no Slack client is available in the context
- **THEN** the `stop_tracking` tool is NOT registered

#### Scenario: Already disengaged thread

- **WHEN** Claude calls `stop_tracking` on a thread where `autoResponseActive` is already `false`
- **THEN** the tool returns success (idempotent)
- **AND** does not modify the session

## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register `stop_tracking` alongside existing query tools for all roles when a Slack client is available.

#### Scenario: Member user tool set

- **WHEN** the user has the member role in query mode
- **AND** a Slack client is available
- **THEN** the tool server registers `stop_tracking` alongside existing query tools (`list_repositories`, `git_log`, `deepen_history`, `find_sessions`, `find_changes`, `find_pull_requests`, `resolve_review_thread`) and `submit_response`

#### Scenario: Dev user tool set includes stop_tracking

- **WHEN** the user has the dev role (or higher) in query mode
- **AND** a Slack client is available
- **THEN** the tool server registers `stop_tracking` alongside all dev-level tools

#### Scenario: Admin user tool set includes stop_tracking

- **WHEN** the user has the admin or owner role in query mode
- **AND** a Slack client is available
- **THEN** the tool server registers `stop_tracking` alongside all admin-level tools
