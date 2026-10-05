## MODIFIED Requirements

### Requirement: Upload Content to Slack

The system SHALL provide an `upload_file` MCP tool that uploads a file to Slack via `files.uploadV2`, from exactly one of two sources: inline `content` (string) or `file_path` (a file in the calling session's downloads folder). Calling with both or neither SHALL return an error result. With `content`, `filename` is required; with `file_path`, `filename` defaults to the file's basename. The tool description SHALL state that an export's result already carries its row count and a preview, so an export does not need to be read before uploading it, and that a file that must be inspected is read in slices (`offset`/`limit`), never re-typed as `content`.

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

#### Scenario: Upload an export by path

- **WHEN** Claude calls `upload_file` with the `file_path` a Metabase export returned
- **THEN** the tool uploads the file's bytes without Claude reading or re-typing them, names it after the file's basename, and returns `{ ok: true, file_id, permalink }`
- **AND** the file's ledger entry records `uploadedAt`, `file_id`, `permalink`, and the destination

#### Scenario: Both or neither source

- **WHEN** Claude calls `upload_file` with both `content` and `file_path`, or with neither
- **THEN** the tool returns an error result naming the two sources

### Requirement: Content Validation

The system SHALL validate the source before attempting upload. Inline `content` SHALL be non-empty and at most 64 KB. A `file_path` SHALL resolve (symlinks followed) to a regular, non-empty file inside the calling session's downloads folder, and its size SHALL be checked before it is read, with a 50 MB limit.

#### Scenario: Empty content rejected

- **WHEN** Claude calls `upload_file` with empty or whitespace-only `content`
- **THEN** the tool returns an error result indicating content must be non-empty

#### Scenario: Content size limit

- **WHEN** Claude calls `upload_file` with content exceeding 64 KB
- **THEN** the tool returns an error result indicating the content is too large to pass inline
- **AND** the error message says a file already in the downloads folder is uploaded with `file_path`, and that other content is summarized or split

#### Scenario: Path outside the session folder

- **WHEN** Claude calls `upload_file` with a `file_path` that resolves outside the calling session's downloads folder (another session's folder, `..` segments, a symlink leaving the folder, or an arbitrary system path)
- **THEN** the tool returns an error result and reads nothing

#### Scenario: File too large

- **WHEN** the resolved file is larger than 50 MB
- **THEN** the tool returns an error result stating the size and limit, without reading the file

#### Scenario: Missing, empty, or non-regular file

- **WHEN** the path does not exist, is a directory, or is an empty file
- **THEN** the tool returns an error result describing which

### Requirement: Error Handling

The system SHALL return structured error results for Slack API failures.

#### Scenario: Slack API failure

- **WHEN** `files.uploadV2` fails (network error, rate limit, etc.)
- **THEN** the tool returns an error result with the Slack error message
- **AND** Claude can inform the user via `submit_response`
- **AND** a path upload's ledger entry is left without `uploadedAt`

#### Scenario: Bot not in channel

- **WHEN** Claude targets an explicit channel the bot is not a member of
- **THEN** the tool returns an error result indicating the bot cannot post to that channel

#### Scenario: Missing Slack client

- **WHEN** the tool is called but no Slack client is available in context
- **THEN** the tool returns an error result indicating file upload requires a Slack connection
