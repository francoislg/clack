# slack-message-trigger Specification

## Purpose
TBD - created by archiving change add-message-mode. Update Purpose after archive.
## Requirements
### Requirement: Message Mode Configuration
The system SHALL support enabling/disabling message mode via configuration.

#### Scenario: Message mode disabled by default
- **WHEN** `directMessages.enabled` is not set in configuration
- **THEN** the system does not listen for DMs or @mentions
- **AND** defaults to disabled

#### Scenario: Message mode enabled
- **WHEN** `directMessages.enabled` is set to `true`
- **THEN** the system registers handlers for DMs and @mentions
- **AND** responds to direct messages and channel mentions

### Requirement: Direct Message Handling
The system SHALL handle direct messages via the Bolt Assistant API, processing user messages through the standard query flow with streaming delivery.

#### Scenario: User sends message in assistant thread
- **WHEN** a user sends a message in an assistant thread
- **THEN** the system processes it via the Assistant's `userMessage` handler
- **AND** calls `setStatus()` for thinking indication
- **AND** routes to `processMessage` with `triggerType: "directMessages"`
- **AND** starts a chat stream with plan blocks showing tool progress
- **AND** stops the stream with the final response blocks on completion

#### Scenario: User sends message with images in assistant thread

- **WHEN** a user sends a message in an assistant thread containing uploaded images
- **THEN** the system extracts image file metadata from the message event
- **AND** passes the image metadata to `processMessage` alongside the message text

#### Scenario: Follow-up in assistant thread
- **WHEN** a user sends a follow-up message in an existing assistant thread
- **THEN** the system continues the existing session
- **AND** processes the message with full conversation history
- **AND** starts a new chat stream for the reply with plan blocks

### Requirement: Channel Mention Handling
The system SHALL respond when @mentioned in a channel, and SHALL register in-flight requests for cancellation support. Channel mentions now use streaming instead of posting and updating an "Investigating..." message.

#### Scenario: User mentions bot in channel
- **WHEN** a user @mentions the bot in a channel message
- **THEN** the system creates or continues a session
- **AND** starts a chat stream in the thread with plan blocks showing tool progress
- **AND** stops the stream with the final response blocks on completion

#### Scenario: User mentions bot with images

- **WHEN** a user @mentions the bot in a channel message containing uploaded images
- **THEN** the system extracts image file metadata from the mention event
- **AND** passes the image metadata to `processMessage` alongside the cleaned message text

#### Scenario: Thread reply in channel
- **WHEN** a user posts in a thread started by a bot @mention
- **THEN** the system continues the existing session
- **AND** starts a new chat stream for the reply with plan blocks

### Requirement: Visible Response Updates
The system SHALL deliver responses via streaming rather than by posting a placeholder and updating it.

#### Scenario: Response message lifecycle
- **WHEN** processing a message mode query
- **THEN** the system starts a chat stream with live tool progress (task cards)
- **AND** finalizes the stream with the complete response on completion
- **AND** does NOT post a separate "Investigating..." placeholder message

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

### Requirement: Inline Stop Emoji Detection

The system SHALL detect the configured stop emoji (`config.reactions.stop`) appearing inline in message text for DMs, @mentions, and thread replies, treating a match as equivalent to adding the stop reaction to the message. Detection SHALL run before pre-analysis, auto-respond rule matching, and `processMessage` dispatch, and SHALL be a cheap synchronous check (no LLM call, no network round-trip).

#### Scenario: Inline stop emoji triggers stop behavior

- **WHEN** a non-bot message arrives via DM, @mention, or thread reply
- **AND** `config.reactions.stop` is set to a non-empty string
- **AND** the trimmed message text is 60 characters or fewer
- **AND** the text contains either the Unicode form of `config.reactions.stop` OR the colon shortcode `:<name>:` where `<name>` equals `config.reactions.stop`
- **THEN** the system does NOT call `processMessage`
- **AND** does NOT run pre-analysis
- **AND** does NOT run auto-respond rule matching
- **AND** dispatches to the same thread-scoped cancel + disengage pipeline used by the stop reaction (abort in-flight query/worker work for the thread, set `autoResponseActive = false`)
- **AND** does NOT post a reply

#### Scenario: Inline stop emoji in a long message is ignored

- **WHEN** a message contains the configured stop emoji
- **AND** the trimmed message text is longer than 60 characters
- **THEN** the inline detection does NOT fire
- **AND** the message proceeds through normal pre-analysis and `processMessage` dispatch

#### Scenario: Stop emoji in colon shortcode form matches

- **WHEN** a message contains `:<name>:` where `<name>` equals `config.reactions.stop` (e.g., `:octagonal_sign:`)
- **AND** the trimmed message text is 60 characters or fewer
- **THEN** the inline detection fires, regardless of whether the Unicode form is also present

#### Scenario: Stop emoji in Unicode form matches

- **WHEN** a message contains the rendered Unicode codepoint for `config.reactions.stop` (e.g., 🛑 for `octagonal_sign`)
- **AND** the trimmed message text is 60 characters or fewer
- **THEN** the inline detection fires, regardless of whether the colon form is also present

#### Scenario: Custom emoji without Unicode form matches via colon only

- **WHEN** `config.reactions.stop` is set to a custom emoji name (e.g., `clack-stop`) that has no standard Unicode codepoint
- **AND** a message contains `:clack-stop:` and is 60 characters or fewer
- **THEN** the inline detection fires

#### Scenario: Inline detection disabled when config is unset

- **WHEN** `config.reactions.stop` is unset, `null`, or an empty string
- **THEN** the system does NOT run inline stop-emoji detection on any message
- **AND** messages proceed through normal handling

#### Scenario: Detection fires for any thread participant

- **WHEN** a message matching the inline detection rule is posted by any user in a thread (not restricted to the original requester or mentioner)
- **THEN** the inline detection fires and stops the thread

#### Scenario: Detection ignores bot messages

- **WHEN** a message matching the inline detection rule would otherwise fire, but the message is from the bot itself or another bot (`bot_id` matches a bot)
- **THEN** the inline detection does NOT fire

#### Scenario: Detection ignores message edits

- **WHEN** a user edits an existing message to add the stop emoji after the fact (`message_changed` subtype)
- **THEN** the inline detection does NOT fire
- **AND** behavior mirrors the stop reaction, which only fires on `reaction_added` events (not edits or reaction replacements)

#### Scenario: Detection short-circuits before pre-analysis

- **WHEN** a message matching the inline detection rule arrives in a handler that would otherwise run pre-analysis
- **THEN** pre-analysis is NOT invoked
- **AND** no LLM call is made in service of deciding whether to respond
