# clack-tools Specification

## Purpose
In-process MCP tool server providing query, action, and presentation tools to Claude during Slack bot queries. Tools are built per-query with closure-captured context and gated by user role.
## Requirements
### Requirement: In-Process MCP Tool Server

The system SHALL provide in-process MCP tool servers using the Agent SDK's `createSdkMcpServer()` function. In query mode the assembly returns a `Record<string, McpServerConfig>` containing one `clack` server for core tools plus one dedicated server per loaded plugin (keyed by plugin name). In worker mode the assembly returns a single `clack` server instance. This is a breaking change from the prior single-server query-mode return shape.

#### Scenario: Query-mode tool assembly returns a record of MCP servers

- **WHEN** `askClaude()` prepares a query and calls the query-mode tool assembly
- **THEN** the assembly returns an `mcpServers` record whose keys include `clack` and one entry per loaded plugin (keyed by plugin name)
- **AND** the caller spreads this record into the Agent SDK's `mcpServers` option alongside external servers (GitHub, Sentry, etc.)
- **AND** each server is scoped to the lifetime of that single query

#### Scenario: Worker-mode tool assembly returns a single server

- **WHEN** a worker Claude invocation is prepared
- **THEN** the assembly returns a single `clack` MCP server
- **AND** no plugin servers are produced in worker mode
- **AND** the server is passed in the `mcpServers` option to the Agent SDK `query()` call

#### Scenario: Tool server captures query context via closure

- **WHEN** a tool server is built
- **THEN** tool handlers close over the provided context (query or worker)
- **AND** tool handlers do NOT require Claude to pass context as tool parameters

#### Scenario: Reaction tools registered when Slack client available

- **WHEN** the `clack` core tool server is built in query mode
- **AND** a Slack client is available in the context
- **THEN** the core server registers the `add_reaction` and `remove_reaction` tools
- **AND** both tools are available to all roles (no role gating)

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

#### Scenario: Context includes available images

- **WHEN** the tool builder is called in query mode
- **AND** image files were extracted from the triggering message or thread context
- **THEN** the context includes `availableImages` — a Map of Slack file ID to image metadata (name, mimetype, size, url_private)

#### Scenario: Worker context includes worktree and session info

- **WHEN** the tool builder is called in worker mode
- **THEN** the context includes mode `"worker"`, the worktree path, branch name, repo name, and repo URL
- **AND** includes the Slack channel ID and thread timestamp (for `report_status`)
- **AND** includes the change session ID (for session state updates)
- **AND** includes the app configuration

### Requirement: Role-Based Tool Gating

The system SHALL register tools based on the user's role, workflow configuration, feature flags, and active plugins. Core tools go into the `clack` MCP server; plugin tools go into each plugin's own MCP server. Plugin-registered tools are included when the user's role meets the declared minimum.

#### Scenario: Member user tool set

- **WHEN** the user has the member role in query mode
- **THEN** the `clack` server registers core query tools and `submit_response`
- **AND** registers `find_user`, `find_emoji`, and `upload_file` if a Slack client is available
- **AND** registers scheduling tools if `allowScheduledMessages` is enabled and a Slack client is available
- **AND** each plugin server registers that plugin's tools where the declared minimum role is `member`
- **AND** plugin servers do NOT register tools with a higher minimum role

#### Scenario: Dev user tool set with plugins

- **GIVEN** the changes workflow is enabled for the trigger type
- **AND** a plugin has registered tools with minimum role `dev`
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the `clack` server registers all core query tools, change tools, and `submit_response`
- **AND** each plugin server registers that plugin's tools with minimum role `member` or `dev`
- **AND** plugin servers do NOT register tools with minimum role `admin` or `owner`

#### Scenario: Plugin tools not included in worker mode

- **WHEN** the tool server is built with mode `"worker"`
- **THEN** the assembly produces only the `clack` core worker server (`git_push`, `ensure_pr`, `merge_pr`, `close_pr`, `report_status`)
- **AND** no plugin MCP servers are produced
- **AND** plugin tool registration is strictly query-mode only

#### Scenario: Plugin tools live in per-plugin servers, not in `clack`

- **GIVEN** plugins have registered tools
- **WHEN** the query-mode assembly runs
- **THEN** each plugin's tools are placed in a dedicated `createSdkMcpServer({ name: pluginName, ... })` instance
- **AND** no plugin tool is added to the `clack` server
- **AND** Claude sees each plugin's tools as `mcp__<plugin>__<tool>`

#### Scenario: Tool name collision with core tools is structurally impossible

- **GIVEN** a plugin registers a tool with the same bare name as a core tool (e.g., `submit_response`)
- **WHEN** the query-mode assembly runs
- **THEN** both tools load successfully because they live in different MCP servers
- **AND** Claude sees the core tool as `mcp__clack__submit_response` and the plugin tool as `mcp__<plugin>__submit_response`
- **AND** no warning about duplication is logged (the prior collision guard is no longer necessary)

### Requirement: Admin Config Tool Registration

The system SHALL register admin config tools (`admin_read_file`, `admin_write_file`, `admin_restart_app`) for users with admin or owner role.

#### Scenario: Admin tools registered for admin users
- **WHEN** the tool server is built in query mode
- **AND** the user has admin or owner role
- **THEN** `admin_read_file`, `admin_write_file`, and `admin_restart_app` are registered

#### Scenario: Admin tools not registered for non-admin users
- **WHEN** the tool server is built in query mode
- **AND** the user has member or dev role
- **THEN** `admin_read_file`, `admin_write_file`, and `admin_restart_app` are NOT registered

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

### Requirement: Admin Role Tool Registration

The system SHALL register `admin_set_role` for users with admin or owner role.

#### Scenario: Admin role tool registered for admin users
- **WHEN** the tool server is built in query mode
- **AND** the user has admin or owner role
- **THEN** `admin_set_role` is registered

#### Scenario: Admin role tool not registered for non-admin users
- **WHEN** the tool server is built in query mode
- **AND** the user has member or dev role
- **THEN** `admin_set_role` is NOT registered

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

#### Scenario: find_user tool
- **WHEN** Claude calls `find_user` with a `query` array of search terms
- **THEN** the tool searches workspace members using the `UsersCache` abstraction
- **AND** returns matching users with userId, username, and displayName

#### Scenario: find_emoji tool
- **WHEN** Claude calls `find_emoji` with a `query` string
- **THEN** the tool searches custom workspace emojis using the `EmojiCache` abstraction
- **AND** returns matching emojis with name, URL, and optional alias information

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

### Requirement: find_recent_interactions Tool Registration
The system SHALL register the `find_recent_interactions` tool in the query tool set, available to all user roles.

#### Scenario: Tool available to all roles
- **WHEN** `buildQueryTools` assembles the tool list
- **THEN** `find_recent_interactions` is included regardless of the user's role (member, dev, admin, owner)

#### Scenario: Tool not available in worker mode
- **WHEN** `buildWorkerTools` assembles the tool list
- **THEN** `find_recent_interactions` is NOT included (worker mode has no need for session history)

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

### Requirement: fetch_slack_message Query Tool

The system SHALL provide a `fetch_slack_message` query tool that fetches a Slack message and its thread context from a URL, with pagination support.

#### Scenario: Tool registered when Slack client available

- **WHEN** the tool server is built in query mode
- **AND** a Slack client is available in the context
- **THEN** the tool server registers the `fetch_slack_message` tool

#### Scenario: Fetch thread with default pagination

- **WHEN** Claude calls `fetch_slack_message` with a valid Slack message URL
- **AND** no `page` or `limit` parameters are provided
- **THEN** the tool fetches the thread via `conversations.replies` using the message's timestamp
- **AND** returns up to 5 messages (the default limit) starting from the beginning of the thread, in chronological order (oldest first)
- **AND** includes `has_more: true` if additional messages exist beyond the returned page

#### Scenario: Fetch thread with custom page and limit

- **WHEN** Claude calls `fetch_slack_message` with `page: 1` and `limit: 20`
- **THEN** the tool fetches enough messages to cover the requested page window
- **AND** returns the second page of 20 messages, skipping the first 20
- **AND** includes `has_more` indicating whether more messages exist

#### Scenario: Fetch standalone message with no thread

- **WHEN** Claude calls `fetch_slack_message` with a URL pointing to a message that has no thread replies
- **THEN** the tool returns that single message
- **AND** includes `has_more: false`

#### Scenario: Fetch message from thread reply URL

- **WHEN** Claude calls `fetch_slack_message` with a URL containing a `?thread_ts=` query parameter
- **THEN** the tool uses the `thread_ts` as the parent timestamp for `conversations.replies`
- **AND** returns paginated messages from the full thread (not just the linked reply)

#### Scenario: Message response format

- **WHEN** the tool returns messages
- **THEN** each message includes: user display name, text, timestamp, and bot flag
- **AND** `<@USERID>` mentions in message text are resolved to readable display names
- **AND** images and files attached to messages are registered in `ctx.availableImages` and `ctx.availableFiles`
- **AND** reactions are included as a structured array with emoji name and resolved usernames, omitted when no reactions exist
- **AND** the response includes `channel`, `thread_ts`, `message_count`, `page`, `limit`, and `has_more`

#### Scenario: Page beyond thread length

- **WHEN** Claude calls `fetch_slack_message` with a `page` value that exceeds the thread's message count
- **THEN** the tool returns an empty messages array with `message_count: 0` and `has_more: false`

#### Scenario: Fetch exceeds maximum cap

- **WHEN** Claude calls `fetch_slack_message` with `page` and `limit` values where `(page + 1) * limit` exceeds 200
- **THEN** the tool returns an error result indicating the requested range exceeds the maximum fetch cap

#### Scenario: Invalid Slack message URL

- **WHEN** Claude calls `fetch_slack_message` with a URL that does not match the Slack message URL pattern
- **THEN** the tool returns an error result indicating invalid URL format

#### Scenario: Slack client not available

- **WHEN** the tool is called without a Slack client in the context
- **THEN** the tool returns an error result indicating the Slack client is unavailable

#### Scenario: Empty thread result

- **WHEN** the Slack API returns no messages for the given timestamp
- **THEN** the tool returns an error result indicating the message or thread was not found

### Requirement: view_slack_image Query Tool

The system SHALL provide a `view_slack_image` query tool that downloads and returns Slack image content on-demand, gated on image availability.

#### Scenario: Tool registered when images available

- **WHEN** the tool server is built in query mode
- **AND** `ctx.availableImages` contains one or more image entries
- **THEN** the tool server registers the `view_slack_image` tool

#### Scenario: Tool not registered when no images

- **WHEN** the tool server is built in query mode
- **AND** `ctx.availableImages` is empty or undefined
- **THEN** the tool server does NOT register the `view_slack_image` tool

#### Scenario: View image by file ID

- **WHEN** Claude calls `view_slack_image` with a valid `file_id`
- **AND** the file ID exists in `ctx.availableImages`
- **THEN** the tool checks the disk cache first
- **AND** on cache miss, downloads the image from Slack using `url_private` with `Authorization: Bearer {botToken}`
- **AND** caches the image to disk
- **AND** returns the image as MCP `ImageContent` (type: "image", base64-encoded data, mimeType)

#### Scenario: View cached image

- **WHEN** Claude calls `view_slack_image` with a `file_id` that is already cached
- **THEN** the tool returns the cached image as MCP `ImageContent` without making a Slack API call

#### Scenario: Unknown file ID

- **WHEN** Claude calls `view_slack_image` with a `file_id` not in `ctx.availableImages`
- **THEN** the tool returns an error result listing the available file IDs

#### Scenario: Download failure

- **WHEN** the image download from Slack fails (network error, expired URL, etc.)
- **THEN** the tool returns an error result with a descriptive message

#### Scenario: Tool not available in worker mode

- **WHEN** the tool server is built in worker mode
- **THEN** the `view_slack_image` tool is NOT registered (regardless of context)

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

### Requirement: create_scheduled_message Tool

The system SHALL provide a `create_scheduled_message` tool for creating cron jobs through conversation.

#### Scenario: Create a recurring dynamic job
- **WHEN** Claude calls `create_scheduled_message` with `channel`, `cronExpression`, `prompt`, and `timezone`
- **THEN** the tool resolves the channel name to an ID (if needed)
- **AND** validates the cron expression using `cron-parser`
- **AND** creates the cron job with the creator's user ID
- **AND** returns the job ID, next run time, and human-readable schedule

#### Scenario: Create a static job
- **WHEN** Claude calls `create_scheduled_message` with `channel`, `cronExpression`, `staticMessage`, and `timezone`
- **THEN** the tool creates a cron job that posts the static message directly (no Claude session)

#### Scenario: Create a one-shot job
- **WHEN** Claude calls `create_scheduled_message` with `oneShot: true`
- **THEN** the tool creates a job that auto-deletes after its first execution

#### Scenario: Create with skipConditions
- **WHEN** Claude calls `create_scheduled_message` with a non-empty `skipConditions` string
- **THEN** the tool stores the conditions on the cron job verbatim
- **AND** subsequent runs of the job evaluate the conditions and may skip delivery
- **AND** the tool response indicates that skip conditions were captured

#### Scenario: Specify repositories for dynamic jobs
- **WHEN** Claude calls `create_scheduled_message` with `repositories` array
- **THEN** the tool validates that the creator has read access to the specified repositories
- **AND** stores them on the job for use during execution

#### Scenario: Invalid cron expression
- **WHEN** Claude calls `create_scheduled_message` with an unparseable cron expression
- **THEN** the tool returns an error describing the issue

#### Scenario: Channel resolution failure
- **WHEN** the specified channel cannot be found or the bot is not a member
- **THEN** the tool returns an error indicating the channel issue

#### Scenario: Tool gating
- **WHEN** the tool server is built
- **AND** `allowScheduledMessages` is enabled in config
- **AND** a Slack client is available
- **THEN** the `create_scheduled_message` tool is registered

### Requirement: list_scheduled_messages Tool

The system SHALL provide a `list_scheduled_messages` tool for listing cron jobs.

#### Scenario: List all jobs for user
- **WHEN** Claude calls `list_scheduled_messages` without filters
- **THEN** the tool returns all cron jobs created by the current user
- **AND** each entry includes: id, channel, human-readable schedule, prompt/staticMessage summary, enabled status, last run info
- **AND** each entry includes `skipConditions` when set on the job (omitted otherwise). `skipConditions` is returned to anyone allowed to see the job (creator for their own jobs, admins/owners for all jobs) — it mirrors the visibility of `prompt` and `requiredTools`
- **AND** each entry's last-run status SHALL surface `"skipped"` distinctly from `"success"` and `"error"` when the most recent run was skipped

#### Scenario: List jobs for a channel
- **WHEN** Claude calls `list_scheduled_messages` with a `channel` filter
- **THEN** the tool returns only jobs targeting that channel (created by the current user)

#### Scenario: Admin lists all jobs
- **WHEN** Claude calls `list_scheduled_messages` with `all: true`
- **AND** the current user is an admin or owner
- **THEN** the tool returns all cron jobs across all users

#### Scenario: No scheduled messages
- **WHEN** no cron jobs match the filter
- **THEN** the tool returns an empty list with a descriptive message

### Requirement: cancel_scheduled_message Tool

The system SHALL provide a `cancel_scheduled_message` tool for deleting cron jobs.

#### Scenario: Cancel by ID
- **WHEN** Claude calls `cancel_scheduled_message` with a job `id`
- **THEN** the tool deletes the cron job
- **AND** returns confirmation

#### Scenario: Cancel own job
- **WHEN** a non-admin user cancels a job they created
- **THEN** the tool deletes the job

#### Scenario: Admin cancels any job
- **WHEN** an admin or owner cancels any job
- **THEN** the tool deletes the job regardless of creator

#### Scenario: Cancel non-owned job as non-admin
- **WHEN** a non-admin user attempts to cancel a job created by another user
- **THEN** the tool returns an error indicating insufficient permissions

#### Scenario: Cancel non-existent job
- **WHEN** Claude calls `cancel_scheduled_message` with an ID that does not exist
- **THEN** the tool returns an error indicating the job was not found

### Requirement: update_scheduled_message Supports skipConditions

The existing `update_scheduled_message` tool SHALL accept an optional `skipConditions` parameter that sets, replaces, or clears the stored value on the target cron job. Edit permissions SHALL match the existing `cancel_scheduled_message` rules: the job's creator OR an admin/owner may update `skipConditions`; other users are rejected.

#### Scenario: Update sets skipConditions
- **WHEN** Claude calls `update_scheduled_message` with a job `id` and a non-empty `skipConditions` string
- **AND** the calling user is the job's creator or an admin/owner
- **THEN** the tool updates the cron job's `skipConditions` field
- **AND** returns confirmation including the new value

#### Scenario: Update clears skipConditions
- **WHEN** Claude calls `update_scheduled_message` with `skipConditions: ""` (empty string)
- **AND** the calling user is the job's creator or an admin/owner
- **THEN** the tool removes the `skipConditions` field from the cron job
- **AND** returns confirmation that conditions were cleared

#### Scenario: Update leaves skipConditions unchanged
- **WHEN** Claude calls `update_scheduled_message` without `skipConditions` in the arguments
- **THEN** the stored field is left unchanged

#### Scenario: Update by non-creator non-admin is rejected
- **WHEN** a non-admin user attempts to update `skipConditions` on a job created by another user
- **THEN** the tool returns an error indicating insufficient permissions
- **AND** no change is persisted

#### Scenario: Update a non-existent job
- **WHEN** Claude calls `update_scheduled_message` with an `id` that does not match any cron job
- **THEN** the tool returns an error indicating the job was not found
- **AND** no job is created

### Requirement: get_scheduled_message_runs Surfaces Skip Outcome

The existing `get_scheduled_message_runs` tool SHALL return the `"skipped"` status on run entries (in addition to `"success"` and `"error"`).

#### Scenario: Runs tool returns skipped entries
- **WHEN** Claude calls `get_scheduled_message_runs` for a job whose history contains skipped runs
- **THEN** each such entry SHALL include `status: "skipped"` and no `responseTs`
- **AND** successful and failed entries remain unchanged

### Requirement: Staged Intent Storage

The system SHALL maintain a per-query Map of staged intents for reference resolution.

#### Scenario: Intent stored on action tool success

- **WHEN** an action tool validates successfully
- **THEN** the intent (type + validated parameters) is stored in a Map keyed by a generated ref ID
- **AND** the ref ID is returned to Claude

#### Scenario: Intent resolved by submit_response

- **WHEN** `submit_response` includes an action with a ref
- **THEN** the system resolves the ref from the staged intents Map
- **AND** attaches the validated data to the action for the button handler

#### Scenario: Intents serialized to session

- **WHEN** the query completes
- **THEN** staged intents referenced in the final `submit_response` are serialized into the session
- **AND** button handlers can resolve refs even after the query closure is garbage collected

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

