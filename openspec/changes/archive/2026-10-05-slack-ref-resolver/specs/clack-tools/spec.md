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

#### Scenario: Context includes referenced Slack items

- **WHEN** the tool builder is called in query mode
- **THEN** the context includes `availableRefs`, a Map of reference id to resolved Slack reference (kind, reader, facts, and whether it came from the current message)
- **AND** it holds the references resolved from the current message, the session's original trigger and the thread context

#### Scenario: Worker context includes worktree and session info

- **WHEN** the tool builder is called in worker mode
- **THEN** the context includes mode `"worker"`, the worktree path, branch name, repo name, and repo URL
- **AND** includes the Slack channel ID and thread timestamp (for `report_status`)
- **AND** includes the change session ID (for session state updates)
- **AND** includes the app configuration

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
- **AND** files attached to or referenced in each message are registered in `ctx.availableRefs` and listed in that message's `files` entry with their kind and reader tool
- **AND** reactions are included as a structured array with emoji name and resolved usernames, omitted when no reactions exist
- **AND** the response includes `channel`, `thread_ts`, `message_count`, `page`, `limit`, and `has_more`

#### Scenario: Page beyond thread length

- **WHEN** Claude calls `fetch_slack_message` with a `page` value that exceeds the thread's message count
- **THEN** the tool returns an empty messages array with `message_count: 0` and `has_more: false`

#### Scenario: Fetch exceeds maximum cap

- **WHEN** Claude calls `fetch_slack_message` with `page` and `limit` values where `(page + 1) * limit` exceeds 200
- **THEN** the tool returns an error result indicating the requested range exceeds the maximum fetch cap

#### Scenario: A file reference instead of a message link

- **WHEN** Claude calls `fetch_slack_message` with a Slack file id or file URL
- **THEN** the tool returns an error naming the file's kind and its reader tool

#### Scenario: Invalid Slack message URL

- **WHEN** Claude calls `fetch_slack_message` with a value that is no Slack reference
- **THEN** the tool returns an error result indicating invalid URL format

#### Scenario: Slack client not available

- **WHEN** the tool is called without a Slack client in the context
- **THEN** the tool returns an error result indicating the Slack client is unavailable

#### Scenario: Empty thread result

- **WHEN** the Slack API returns no messages for the given timestamp
- **THEN** the tool returns an error result indicating the message or thread was not found

## REMOVED Requirements

### Requirement: view_slack_image Query Tool

**Reason**: `view_slack_file` opens images, so one tool reads every attached file.

**Migration**: Claude calls `view_slack_file` with the image's file id; the image comes back as an `image` content block.
