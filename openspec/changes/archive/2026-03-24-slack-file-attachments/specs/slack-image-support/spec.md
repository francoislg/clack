## MODIFIED Requirements

### Requirement: Image Disk Cache

The system SHALL cache downloaded images on disk to avoid redundant Slack API calls across follow-up queries and retries.

#### Scenario: Cache miss downloads and stores

- **WHEN** the `view_slack_image` tool is called for a file ID not in the cache
- **THEN** the system downloads the image from Slack and stores it in `data/cache/files/`
- **AND** creates a metadata sidecar file (`{fileId}.meta.json`) with mimeType, originalName, and timestamp

#### Scenario: Cache hit returns stored image

- **WHEN** the `view_slack_image` tool is called for a file ID already in the cache
- **THEN** the system reads the cached image from disk without making a Slack API call
- **AND** returns the same base64-encoded image content

#### Scenario: Cache persists across sessions

- **WHEN** a different session references the same Slack file ID
- **THEN** the cached image is reused from `data/cache/files/`

### Requirement: Image Metadata in Prompt

The system SHALL include image metadata in the user prompt when images are available, so Claude knows what images exist and can decide whether to view them.

#### Scenario: Prompt includes image metadata section

- **WHEN** the triggering message or thread context contains extracted image files
- **THEN** the prompt includes an "ATTACHED FILES" section listing each image's filename, file ID, and type
- **AND** annotates images with `view_slack_image` as the tool to use

#### Scenario: Prompt omits attachment section when no attachments

- **WHEN** neither the triggering message nor thread context contains image files or other file attachments
- **THEN** the prompt does not include an attachment metadata section

#### Scenario: Prompt instructs Claude to view all direct attachments

- **WHEN** the attachment metadata section is present
- **THEN** it instructs Claude to call the appropriate viewing tool for each attachment before answering
