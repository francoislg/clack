# clack-tools Specification

## Purpose
In-process MCP tool server providing query, action, and presentation tools to Claude during Slack bot queries. Tools are built per-query with closure-captured context and gated by user role.

## Requirements
### Requirement: In-Process MCP Tool Server

The system SHALL provide an in-process MCP tool server using the Agent SDK's `createSdkMcpServer()` function, registered as the `clack` MCP server alongside external servers.

#### Scenario: Tool server created per query

- **WHEN** `askClaude()` prepares a query
- **THEN** the system builds a fresh `clack` MCP server via `createSdkMcpServer()`
- **AND** passes it in the `mcpServers` option alongside external MCP servers (GitHub, Sentry, etc.)
- **AND** the server is scoped to the lifetime of that single query

#### Scenario: Tool server created per worker invocation

- **WHEN** a worker Claude invocation is prepared
- **THEN** the system builds a fresh `clack` MCP server via `createSdkMcpServer()`
- **AND** passes it in the `mcpServers` option to the Agent SDK `query()` call
- **AND** the server is scoped to the lifetime of that single worker invocation

#### Scenario: Tool server captures query context via closure

- **WHEN** the tool server is built
- **THEN** tool handlers close over the provided context (query or worker)
- **AND** tool handlers do NOT require Claude to pass context as tool parameters

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
