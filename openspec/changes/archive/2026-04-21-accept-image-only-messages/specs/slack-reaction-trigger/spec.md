## ADDED Requirements

### Requirement: Image-Only Reaction Handling

The system SHALL treat a trigger reaction on a message that contains only image uploads (no text) as a valid request and process it through `processMessage` with a synthesized fallback prompt, rather than posting the "couldn't read the message" ephemeral.

#### Scenario: Trigger reaction on image-only message

- **WHEN** a user adds the configured trigger emoji to a message that has no text but contains one or more supported image uploads
- **THEN** the system does NOT post the "Sorry, I couldn't read the message" ephemeral
- **AND** extracts image file metadata from the resolved message
- **AND** calls `processMessage` with a synthesized `messageText` of `"A user reacted to this message. Look at the attached image(s) and the surrounding conversation to determine what they're asking, then respond."`
- **AND** passes the extracted image metadata alongside the synthesized text
- **AND** preserves the reaction's work-mode semantics (`workMode: true` when the work-mode emoji is used by a dev+ user)

#### Scenario: Trigger reaction on message with no text and no files

- **WHEN** a user adds the configured trigger emoji to a message with no text and no files
- **THEN** the system posts the "Sorry, I couldn't read the message" ephemeral
- **AND** does NOT call `processMessage`
