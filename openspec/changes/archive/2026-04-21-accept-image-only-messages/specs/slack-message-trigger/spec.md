## ADDED Requirements

### Requirement: Image-Only DM Handling

The system SHALL process direct messages that contain only image uploads (no caption text) by synthesizing a fallback user prompt and routing them through `processMessage`.

#### Scenario: User sends image-only DM

- **WHEN** a user sends a DM in an assistant thread with no text but with one or more supported image uploads
- **THEN** the system does NOT short-circuit on empty text
- **AND** extracts image file metadata via `extractAttachments`
- **AND** calls `processMessage` with a synthesized `messageText` of `"Answer based on the attached image(s)."`
- **AND** passes the extracted image metadata alongside the synthesized text
- **AND** the trigger type is `"directMessages"`

#### Scenario: User sends DM with no text and no files

- **WHEN** a user sends a DM with empty text and no files
- **THEN** the system ignores the message without calling `processMessage`

### Requirement: Image-Only Mention Handling

The system SHALL process @mentions that contain only image uploads (no caption text other than the bot mention itself) by synthesizing a fallback user prompt and routing them through `processMessage`.

#### Scenario: Top-level @mention with only images

- **WHEN** a user @mentions the bot in a channel with no other text but with one or more supported image uploads
- **AND** the mention is NOT in a thread (`thread_ts` is unset)
- **THEN** the system does NOT post the "include a question" hint reply
- **AND** extracts image file metadata via `extractAttachments`
- **AND** calls `processMessage` with a synthesized `messageText` of `"Answer based on the attached image(s)."`
- **AND** passes the extracted image metadata alongside the synthesized text

#### Scenario: Top-level @mention with no text and no files

- **WHEN** a user @mentions the bot in a channel with no text and no files
- **AND** the mention is NOT in a thread
- **THEN** the system posts the "include a question" hint reply
- **AND** does NOT call `processMessage`

#### Scenario: In-thread @mention with only images

- **WHEN** a user @mentions the bot in a thread with no other text but with one or more supported image uploads
- **THEN** the system extracts image file metadata
- **AND** calls `processMessage` with the existing thread-aware fallback prompt (`"Read the conversation above..."`)
- **AND** passes the extracted image metadata alongside the fallback text
