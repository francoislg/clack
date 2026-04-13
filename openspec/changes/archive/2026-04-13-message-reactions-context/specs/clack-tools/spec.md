## MODIFIED Requirements

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

- **WHEN** the fetched thread contains no messages
- **THEN** the tool returns an error indicating the message was not found
