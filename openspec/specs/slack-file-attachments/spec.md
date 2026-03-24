# slack-file-attachments Specification

## Purpose
Extract, cache, and surface non-image file attachments (PDFs, text files, code files) from Slack messages so Claude can view and reason about user-uploaded files during query sessions.

## Requirements
### Requirement: File Extraction from Slack Messages

The system SHALL extract non-image file metadata from Slack message objects, filtering for supported file types (PDFs and text-based files).

#### Scenario: Extract PDF files

- **WHEN** a Slack message contains files with MIME type `application/pdf`
- **THEN** the system extracts metadata (id, name, mimetype, size, url_private) for each matching file

#### Scenario: Extract text-based files

- **WHEN** a Slack message contains files with MIME types matching `text/*` or recognized code types (`application/json`, `application/xml`, `application/javascript`, `application/typescript`, `application/x-yaml`, `application/x-sh`)
- **THEN** the system extracts metadata (id, name, mimetype, size, url_private) for each matching file

#### Scenario: Exclude image files

- **WHEN** a Slack message contains files with MIME types `image/png`, `image/jpeg`, `image/gif`, or `image/webp`
- **THEN** those files are excluded from the file extraction list (handled by the image extractor)

#### Scenario: Exclude unsupported binary files from extraction

- **WHEN** a Slack message contains files with unrecognized binary MIME types (e.g., `application/zip`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
- **THEN** those files are still extracted (metadata only) so Claude can report what was attached

#### Scenario: Enforce per-file size limit

- **WHEN** a file exceeds 20MB
- **THEN** that file is excluded from the extracted file list

#### Scenario: Enforce per-message file cap

- **WHEN** a message contains more than 10 supported files (across images and non-image files combined)
- **THEN** only the first 10 non-image files are included in the extracted file list

### Requirement: File Viewing Tool

The system SHALL provide a `view_slack_file` MCP tool that downloads and returns file content using the appropriate Claude API content block type.

#### Scenario: View a PDF file

- **WHEN** the `view_slack_file` tool is called with a file ID for a PDF
- **THEN** the system returns a `document` content block with base64-encoded PDF data and `media_type: "application/pdf"`

#### Scenario: View a text-based file

- **WHEN** the `view_slack_file` tool is called with a file ID for a text-based file
- **THEN** the system reads the downloaded bytes as UTF-8 text
- **AND** returns a `text` content block with the file contents

#### Scenario: View an unsupported binary file

- **WHEN** the `view_slack_file` tool is called with a file ID for an unsupported binary format
- **THEN** the system returns a `text` content block describing the file (name, size, MIME type)
- **AND** the text explains that the file format cannot be read directly

#### Scenario: Handle invalid UTF-8 in text files

- **WHEN** a file classified as text-based contains invalid UTF-8 byte sequences
- **THEN** the system replaces invalid sequences rather than throwing an error

#### Scenario: Unknown file ID

- **WHEN** the `view_slack_file` tool is called with a file ID not in the available files map
- **THEN** the system returns an error result listing the available file IDs

#### Scenario: Tool registered when files are available

- **WHEN** the query context has available files OR a Slack client is available
- **THEN** the `view_slack_file` tool is registered in the Clack MCP server

#### Scenario: Cache hit

- **WHEN** the `view_slack_file` tool is called for a file ID already in the cache
- **THEN** the system reads from the cache without making a Slack API call

#### Scenario: Cache miss

- **WHEN** the `view_slack_file` tool is called for a file ID not in the cache
- **THEN** the system downloads the file from Slack and stores it in the file cache

### Requirement: File Metadata in Prompt

The system SHALL include file metadata in the user prompt when non-image files are available, so Claude knows what files exist and which tool to use.

#### Scenario: Prompt includes file metadata

- **WHEN** the triggering message or thread context contains extracted non-image files
- **THEN** the prompt lists each file with its name, file ID, and type
- **AND** indicates that `view_slack_file` should be used to view them

#### Scenario: Prompt includes both images and files

- **WHEN** both images and non-image files are available
- **THEN** the prompt lists all attachments in a single section
- **AND** annotates each with which tool to use (`view_slack_image` for images, `view_slack_file` for files)

### Requirement: File Metadata in Thread Context

The system SHALL extract and propagate non-image file metadata from thread messages, so files from earlier messages are accessible.

#### Scenario: Thread messages with file attachments

- **WHEN** a thread message contains non-image file attachments
- **THEN** the file metadata is stored in the thread message's context
- **AND** files are added to the available files map for the session

#### Scenario: Thread context text includes file annotations

- **WHEN** a thread message has file attachments
- **THEN** the formatted thread context includes annotations listing the attached files with their file IDs

### Requirement: File Cache

The system SHALL cache downloaded files on disk to avoid redundant Slack API calls.

#### Scenario: File cached after download

- **WHEN** a file is downloaded from Slack
- **THEN** the system stores it in `data/cache/files/` with a metadata sidecar file

#### Scenario: Cached file reused

- **WHEN** a cached file is requested again (same file ID)
- **THEN** the system reads from the cache without downloading
