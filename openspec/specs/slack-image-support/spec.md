# slack-image-support Specification

## Purpose

Extract, cache, and surface image files from Slack messages so Claude can view and reason about user-uploaded images during query sessions.

## Requirements

### Requirement: Image File Extraction

The system SHALL extract image file metadata from Slack message objects into the shared attachment list, where the reference kind table classifies supported image types as `image`.

#### Scenario: Extract supported image files

- **WHEN** a Slack message contains files with MIME types `image/png`, `image/jpeg`, `image/gif`, or `image/webp`
- **THEN** the system extracts metadata (id, name, mimetype, size, url_private) for each
- **AND** the kind table classifies each as an image

#### Scenario: Other file types are not images

- **WHEN** a Slack message contains files with non-image MIME types (e.g., `application/pdf`, `text/plain`)
- **THEN** those files are extracted into the same list
- **AND** the kind table does not classify them as images

#### Scenario: Mark oversized images

- **WHEN** an image file exceeds 20MB
- **THEN** it stays in the list, marked as too large to open

#### Scenario: Enforce per-message cap

- **WHEN** a message contains more than 10 images
- **THEN** only the first 10 images are included in the extracted list

#### Scenario: Handle missing or malformed file objects

- **WHEN** a file object lacks required fields (id, name, mimetype, url_private)
- **THEN** that file is excluded from the extracted list without error

### Requirement: Image Disk Cache

The system SHALL cache downloaded images on disk to avoid redundant Slack API calls across follow-up queries and retries.

#### Scenario: Cache miss downloads and stores

- **WHEN** the `view_slack_file` tool is called for an image not in the cache
- **THEN** the system downloads the image from Slack and stores it in `data/cache/files/`
- **AND** creates a metadata sidecar file (`{fileId}.meta.json`) with mimeType, originalName, and timestamp

#### Scenario: Cache hit returns stored image

- **WHEN** the `view_slack_file` tool is called for an image already in the cache
- **THEN** the system reads the cached image from disk without making a Slack API call
- **AND** returns the same base64-encoded image content

#### Scenario: Cache persists across sessions

- **WHEN** a different session references the same Slack file ID
- **THEN** the cached image is reused from `data/cache/files/`

### Requirement: Image Metadata in Prompt

The system SHALL list available images in the prompt's REFERENCED SLACK ITEMS section, so Claude knows what images exist and opens the ones attached to the current message.

#### Scenario: Prompt includes image metadata

- **WHEN** the triggering message or thread context contains image files
- **THEN** the REFERENCED SLACK ITEMS section lists each image's name and file ID, annotated with `view_slack_file`

#### Scenario: Prompt omits the section when nothing is referenced

- **WHEN** neither the triggering message nor thread context contains attachments or references
- **THEN** the prompt does not include the REFERENCED SLACK ITEMS section

#### Scenario: Prompt instructs Claude to view current-message images before answering

- **WHEN** the section lists an image attached to the current message
- **THEN** it instructs Claude to open that image before answering

#### Scenario: Earlier images are opened on demand

- **WHEN** the section lists an image attached only to an earlier message in the thread
- **THEN** it lists the image without requiring Claude to open it before answering
