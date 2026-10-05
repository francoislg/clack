# slack-file-attachments Specification

## Purpose

Extract, cache, and surface non-image file attachments (PDFs, text files, code files) from Slack messages so Claude can view and reason about user-uploaded files during query sessions.

## Requirements

### Requirement: File Extraction from Slack Messages

The system SHALL extract the metadata of every file attached to a Slack message, of every kind, into one attachment list. It SHALL validate each file object with a zod schema. Kind is assigned later by the reference kind table, not at extraction.

#### Scenario: Extract files of every kind into one list

- **WHEN** a Slack message contains an image, a PDF, a text file and a Slack List
- **THEN** the system extracts metadata (id, name, mimetype, size, url_private, and the `filetype` and `pretty_type` when present) for all four into one list

#### Scenario: Keep unsupported binary files

- **WHEN** a Slack message contains files with unrecognized binary MIME types (e.g., `application/zip`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
- **THEN** those files are still extracted (metadata only) so Claude can report what was attached

#### Scenario: Mark oversized files

- **WHEN** a file exceeds 20MB
- **THEN** the file stays in the list, marked as too large to open, so Claude can say it exists and was not read

#### Scenario: Enforce per-message file cap

- **WHEN** a message contains more than 10 images or more than 10 other files
- **THEN** the list keeps the first 10 images and the first 10 other files

#### Scenario: Skip malformed file objects

- **WHEN** a file object lacks an id, name, mimetype, size or url_private
- **THEN** that file is excluded from the list without error

#### Scenario: Read legacy persisted image lists

- **WHEN** a persisted session or thread-context message carries a legacy `imageFiles` list
- **THEN** its entries are read as part of the attachment list

### Requirement: File Viewing Tool

The system SHALL provide a `view_slack_file` MCP tool that opens any file reference: images, PDFs, text files, and the metadata of every other file. It SHALL resolve its argument through the Slack reference resolver.

#### Scenario: View an image

- **WHEN** the `view_slack_file` tool is called with the id of an image
- **THEN** the system returns an `image` content block with the base64-encoded image and its mime type

#### Scenario: View a PDF file

- **WHEN** the `view_slack_file` tool is called with a file ID for a PDF
- **THEN** the system downloads the PDF to the file cache and returns its path, with an instruction to open it with the Read tool

#### Scenario: View a text-based file

- **WHEN** the `view_slack_file` tool is called with a file ID for a text-based file
- **THEN** the system reads the downloaded bytes as UTF-8 text
- **AND** returns a `text` content block with the file contents

#### Scenario: View an unsupported binary file

- **WHEN** the `view_slack_file` tool is called with a file ID for an unsupported binary format
- **THEN** the system returns a `text` content block describing the file (name, size, MIME type, and Slack's type label when present)
- **AND** the text explains that the file format cannot be read directly

#### Scenario: Handle invalid UTF-8 in text files

- **WHEN** a file classified as text-based contains invalid UTF-8 byte sequences
- **THEN** the system replaces invalid sequences rather than throwing an error

#### Scenario: Oversized file

- **WHEN** the `view_slack_file` tool is called for a file marked too large
- **THEN** the system returns the file's metadata and tells Claude to say the file is too large to open, without downloading it

#### Scenario: File not in the registry

- **WHEN** the `view_slack_file` tool is called with a file ID that is not in the run's registry
- **THEN** the system resolves it with the requester's access check and opens it when allowed, or returns the access-denied message when not

#### Scenario: A reference of another kind

- **WHEN** the `view_slack_file` tool is called with the id of a Slack List or canvas whose reader tool is registered
- **THEN** the system returns an error naming the kind and the tool to use instead

#### Scenario: Download failure

- **WHEN** `view_slack_file` downloads a file of any kind and the download fails
- **THEN** the tool returns an error result with a descriptive message

#### Scenario: Tool registered when files are available

- **WHEN** the query context has registered references OR a Slack client is available
- **THEN** the `view_slack_file` tool is registered in the Clack MCP server

#### Scenario: Cache hit

- **WHEN** the `view_slack_file` tool is called for a file ID already in the cache
- **THEN** the system reads from the cache without making a Slack API call

#### Scenario: Cache miss

- **WHEN** the `view_slack_file` tool is called for a file ID not in the cache
- **THEN** the system downloads the file from Slack and stores it in the file cache

### Requirement: File Metadata in Prompt

The system SHALL list attached and referenced files in the prompt through the REFERENCED SLACK ITEMS section, so Claude knows what each file is and which tool reads it.

#### Scenario: Prompt includes file metadata

- **WHEN** the triggering message or thread context contains attached files
- **THEN** the REFERENCED SLACK ITEMS section lists each file with its kind label, name, file ID and reader tool

#### Scenario: Prompt includes images and files together

- **WHEN** both images and other files are available
- **THEN** they are listed in the same section, each annotated with `view_slack_file` or with its dedicated reader (e.g. `read_list` for a Slack List)

### Requirement: File Metadata in Thread Context

The system SHALL extract and propagate attachment metadata from thread messages, so files from earlier messages are accessible.

#### Scenario: Thread messages with file attachments

- **WHEN** a thread message contains file attachments of any kind
- **THEN** the file metadata is stored in the thread message's context
- **AND** each file is added to the run's registry of referenced items

#### Scenario: Thread context text includes file annotations

- **WHEN** a thread message has attachments or references
- **THEN** the formatted thread context includes one annotation listing them with their kind label, name and id

### Requirement: File Cache

The system SHALL cache downloaded files on disk to avoid redundant Slack API calls.

#### Scenario: File cached after download

- **WHEN** a file is downloaded from Slack
- **THEN** the system stores it in `data/cache/files/` with a metadata sidecar file

#### Scenario: Cached file reused

- **WHEN** a cached file is requested again (same file ID)
- **THEN** the system reads from the cache without downloading
