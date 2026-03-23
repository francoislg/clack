## ADDED Requirements

### Requirement: Image File Extraction

The system SHALL extract image file metadata from Slack message objects, filtering for supported image types.

#### Scenario: Extract supported image files

- **WHEN** a Slack message contains files with MIME types `image/png`, `image/jpeg`, `image/gif`, or `image/webp`
- **THEN** the system extracts metadata (id, name, mimetype, size, url_private) for each matching file

#### Scenario: Ignore non-image files

- **WHEN** a Slack message contains files with non-image MIME types (e.g., `application/pdf`, `text/plain`)
- **THEN** those files are excluded from the extracted image list

#### Scenario: Enforce per-file size limit

- **WHEN** an image file exceeds 20MB
- **THEN** that file is excluded from the extracted image list

#### Scenario: Enforce per-message image cap

- **WHEN** a message contains more than 10 supported image files
- **THEN** only the first 10 are included in the extracted image list

#### Scenario: Handle missing or malformed file objects

- **WHEN** a file object lacks required fields (id, name, mimetype, url_private)
- **THEN** that file is excluded from the extracted image list without error

### Requirement: Image Disk Cache

The system SHALL cache downloaded images on disk to avoid redundant Slack API calls across follow-up queries and retries.

#### Scenario: Cache miss downloads and stores

- **WHEN** the `view_slack_image` tool is called for a file ID not in the cache
- **THEN** the system downloads the image from Slack and stores it in `data/cache/images/`
- **AND** creates a metadata sidecar file (`{fileId}.meta.json`) with mimeType, originalName, and timestamp

#### Scenario: Cache hit returns stored image

- **WHEN** the `view_slack_image` tool is called for a file ID already in the cache
- **THEN** the system reads the cached image from disk without making a Slack API call
- **AND** returns the same base64-encoded image content

#### Scenario: Cache persists across sessions

- **WHEN** a different session references the same Slack file ID
- **THEN** the cached image is reused from `data/cache/images/`

### Requirement: Image Metadata in Prompt

The system SHALL include image metadata in the user prompt when images are available, so Claude knows what images exist and can decide whether to view them.

#### Scenario: Prompt includes image metadata section

- **WHEN** the triggering message or thread context contains extracted image files
- **THEN** the prompt includes an "ATTACHED IMAGES" section listing each image's filename and file ID

#### Scenario: Prompt omits image section when no images

- **WHEN** neither the triggering message nor thread context contains image files
- **THEN** the prompt does not include an image metadata section

#### Scenario: Prompt instructs Claude to use the tool

- **WHEN** the image metadata section is present
- **THEN** it includes guidance telling Claude to use `view_slack_image` to view any relevant image
