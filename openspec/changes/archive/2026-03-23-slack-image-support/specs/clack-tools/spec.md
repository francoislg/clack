## ADDED Requirements

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

## MODIFIED Requirements

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
