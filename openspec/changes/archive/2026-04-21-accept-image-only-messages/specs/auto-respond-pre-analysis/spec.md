## MODIFIED Requirements

### Requirement: Thread Reply Pre-Analysis

The system SHALL run pre-analysis on thread replies in threads with existing active sessions, using thread history as context and a built-in filtering criteria that includes disengagement detection. When a reply has no text but contains image uploads, the system SHALL synthesize a textual image-metadata placeholder and run pre-analysis normally.

#### Scenario: Thread reply passes pre-analysis

- **WHEN** a non-bot message arrives in a thread with an existing Clack session
- **AND** the session has `autoResponseActive === true`
- **AND** the message has non-empty text OR contains one or more supported image uploads
- **THEN** the system fetches up to 15 recent thread replies (excluding the parent message and the current message) via `conversations.replies`
- **AND** uses the last 10 as conversation context
- **AND** resolves @mentions to display names
- **AND** makes a pre-analysis call with a built-in thread-specific filtering criteria focused on detecting genuine follow-up questions vs. noise
- **AND** if Claude responds with "respond", the system proceeds with `processMessage()`

#### Scenario: Thread reply rejected by pre-analysis

- **WHEN** a non-bot message arrives in a thread with an existing Clack session
- **AND** pre-analysis responds with "skip"
- **THEN** the system does NOT call `processMessage()`
- **AND** no response is posted

#### Scenario: Thread reply triggers disengagement

- **WHEN** a non-bot message arrives in a thread with an existing Clack session
- **AND** pre-analysis responds with "stop"
- **THEN** the system sets `autoResponseActive = false` on the session
- **AND** persists the session to disk
- **AND** does NOT call `processMessage()`

#### Scenario: Thread reply with image-only (no text)

- **WHEN** a message arrives in a thread with an existing Clack session
- **AND** the message has empty or undefined text
- **AND** the message contains one or more supported image uploads
- **THEN** the system synthesizes a pre-analysis message text of the form `[image: <filename> (file_id: <id>)]` for each image, joined on newlines, matching the prompt builder's attachment format
- **AND** runs pre-analysis with that synthesized text as the message, using the normal thread history and context
- **AND** respects the `respond`/`skip`/`stop` verdict the same way as text-bearing replies

#### Scenario: Thread reply with no text and no files

- **WHEN** a message arrives in a thread with an existing Clack session
- **AND** the message has empty or undefined text
- **AND** the message has no supported image uploads
- **THEN** the system skips the message without running pre-analysis

#### Scenario: Thread pre-analysis uses shared context

- **WHEN** thread reply pre-analysis runs
- **THEN** the shared pre-analysis context files (from `data/configuration/pre-analysis/` and `data/default_configuration/pre-analysis/`) are loaded and included
- **AND** the channel name is included in the classifier prompt

#### Scenario: Change workflow commands bypass thread pre-analysis

- **WHEN** a thread reply arrives in a thread with an active change (status `pr_created`)
- **AND** the message text matches a change workflow command (e.g., "merge", "ship it", "close")
- **THEN** the system does NOT run pre-analysis
- **AND** returns null (handled by the change workflow)

#### Scenario: Thread pre-analysis error handling

- **WHEN** thread reply pre-analysis fails (network error, timeout, rate limit)
- **THEN** the system skips the message (fail-closed)
- **AND** does NOT set `autoResponseActive` to `false` (an error is not a disengagement signal)
- **AND** logs the error at warn level

#### Scenario: Thread pre-analysis context includes stop guidance

- **WHEN** thread reply pre-analysis runs
- **THEN** the classifier prompt includes guidance to return "stop" when the conversation has clearly moved on from the original topic and the bot is no longer needed
- **AND** distinguishes "stop" (conversation is over for the bot) from "skip" (this specific message isn't for the bot, but the thread is still relevant)
