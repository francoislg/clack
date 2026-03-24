# file-upload Specification

## Purpose
MCP query tool that uploads Claude-generated text content to Slack as a file attachment, enabling delivery of CSVs, reports, code snippets, and other structured data that doesn't fit in a chat message.

## Requirements

## ADDED Requirements

### Requirement: Upload Content to Slack

The system SHALL provide an `upload_file` MCP tool that uploads string content to Slack as a file via `files.uploadV2`.

#### Scenario: Upload to current thread (default)

- **WHEN** Claude calls `upload_file` with `content` and `filename`
- **AND** no explicit `channel` or `thread_ts` is provided
- **THEN** the tool uploads the content to the session's current channel and thread
- **AND** returns `{ ok: true, file_id, permalink }`

#### Scenario: Upload to explicit channel and thread

- **WHEN** Claude calls `upload_file` with `content`, `filename`, and explicit `channel` and `thread_ts`
- **THEN** the tool uploads the content to the specified channel and thread
- **AND** returns `{ ok: true, file_id, permalink }`

#### Scenario: Upload to explicit channel without thread

- **WHEN** Claude calls `upload_file` with `content`, `filename`, and explicit `channel` but no `thread_ts`
- **THEN** the tool uploads the content as a top-level message in the specified channel
- **AND** returns `{ ok: true, file_id, permalink }`

#### Scenario: Upload with optional title

- **WHEN** Claude calls `upload_file` with a `title` parameter
- **THEN** the uploaded file displays the title in Slack's file viewer
- **AND** if no title is provided, the filename is used as the display title

### Requirement: Content Validation

The system SHALL validate content before attempting upload.

#### Scenario: Empty content rejected

- **WHEN** Claude calls `upload_file` with empty or whitespace-only `content`
- **THEN** the tool returns an error result indicating content must be non-empty

#### Scenario: Content size limit

- **WHEN** Claude calls `upload_file` with content exceeding 500KB
- **THEN** the tool returns an error result indicating the content is too large
- **AND** the error message suggests summarizing or splitting the content

### Requirement: Error Handling

The system SHALL return structured error results for Slack API failures.

#### Scenario: Slack API failure

- **WHEN** `files.uploadV2` fails (network error, rate limit, etc.)
- **THEN** the tool returns an error result with the Slack error message
- **AND** Claude can inform the user via `submit_response`

#### Scenario: Bot not in channel

- **WHEN** Claude targets an explicit channel the bot is not a member of
- **THEN** the tool returns an error result indicating the bot cannot post to that channel

#### Scenario: Missing Slack client

- **WHEN** the tool is called but no Slack client is available in context
- **THEN** the tool returns an error result indicating file upload requires a Slack connection
