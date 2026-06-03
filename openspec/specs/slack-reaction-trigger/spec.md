# slack-reaction-trigger Specification

## Purpose
TBD - created by archiving change add-slack-reaction-bot. Update Purpose after archive.
## Requirements
### Requirement: Reaction Detection
The system SHALL listen for configurable emoji reactions and initiate answer generation. When a matching reaction is detected, the system SHALL start a streaming response in the target determined by user preference (DM channel or channel thread).

#### Scenario: Trigger reaction added
- **WHEN** a user adds the configured trigger emoji to a message
- **THEN** the system starts a streaming response targeted at the user's preferred delivery mode (DM or thread)

#### Scenario: Trigger reaction on message with images

- **WHEN** a user adds the configured trigger emoji to a message containing uploaded images
- **THEN** the system extracts image file metadata from the resolved message
- **AND** passes the image metadata to `processMessage` alongside the message text

#### Scenario: Work-mode reaction added
- **WHEN** a user with dev+ role adds the configured work-mode emoji to a message
- **THEN** the system starts a streaming response with `workMode: true` in the user's preferred delivery mode

#### Scenario: Non-trigger reaction ignored
- **WHEN** a user adds an emoji that does not match any configured trigger
- **THEN** no processing occurs

#### Scenario: Bot not in channel
- **WHEN** the bot lacks access to the channel where the reaction was added
- **THEN** the system silently ignores the reaction (no error posted)

### Requirement: Work Mode Reaction Trigger

The system SHALL support a separate "work mode" reaction emoji that adds a prompt hint biasing Claude toward proposing changes, gated by user permissions.

#### Scenario: Dev user reacts with work emoji

- **WHEN** a user with dev role (or higher) adds the configured work-mode reaction emoji to a message
- **THEN** the system calls `processMessage` with `workMode: true`
- **AND** the message is processed through the standard Claude query pipeline with all tools available for the user's role

#### Scenario: Non-dev user reacts with work emoji

- **WHEN** a user without dev role adds the configured work-mode reaction emoji to a message
- **THEN** the system calls `processMessage` without `workMode` (standard Q&A flow)
- **AND** no error or permission message is shown to the user

#### Scenario: Work mode as prompt hint

- **WHEN** `processMessage` is called with `workMode: true`
- **THEN** `askClaude` prepends a work-mode hint to the user prompt
- **AND** the hint biases Claude toward proposing a code change using `propose_change` with `auto: true`
- **AND** the hint tells Claude to ask for clarification via `submit_response` if the request is unclear
- **AND** the hint does NOT change which tools are registered (tool availability is based on role and session state)

### Requirement: Thread Context Reading
The system SHALL include thread context when generating answers for messages in threads.

#### Scenario: Question in thread includes parent context
- **WHEN** the trigger reaction is added to a message that is a thread reply
- **THEN** the system includes the parent message and preceding thread replies as context
- **AND** passes this context to Claude Code for answer generation

#### Scenario: Question on parent message includes thread
- **WHEN** the trigger reaction is added to a parent message that has thread replies
- **THEN** the system includes the thread replies as additional context

#### Scenario: Thread context includes image metadata

- **WHEN** thread context is fetched for a reaction trigger
- **AND** any thread message contains uploaded images
- **THEN** the thread context messages include image file metadata for those messages

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

### Requirement: Stop Reaction Trigger

The system SHALL support a configurable "stop" reaction emoji (`config.reactions.stop`) that, when added to any message in a thread, cancels any in-flight Claude work for that thread and disengages the thread from auto-respond. When `config.reactions.stop` is unset, `null`, or empty, the feature is disabled.

#### Scenario: Stop reaction added to triggering message

- **WHEN** a user adds the configured stop emoji to a message that triggered a Claude query or worker run
- **THEN** the system resolves the thread the message belongs to
- **AND** aborts the in-flight request for that thread (see request-cancellation and worker-cancellation specs)
- **AND** sets the thread's session `attentionLevel` to `"off"` (disengaging from auto-respond; see attention-level spec)
- **AND** takes no destructive action on git, the worktree, or any PR

#### Scenario: Stop reaction added to bot's streamed response

- **WHEN** a user adds the configured stop emoji to a message posted by the bot in a thread
- **THEN** the system resolves the thread
- **AND** aborts any in-flight request associated with that thread
- **AND** sets the thread's session `attentionLevel` to `"off"`

#### Scenario: Stop reaction added to thread parent

- **WHEN** a user adds the configured stop emoji to the parent message of a thread Clack is active in
- **THEN** the system resolves the thread (using the message as the thread parent)
- **AND** aborts any in-flight request associated with that thread
- **AND** sets the thread's session `attentionLevel` to `"off"`

#### Scenario: Stop reaction added to another user's thread reply

- **WHEN** a user adds the configured stop emoji to any other message in the thread (e.g., a teammate's reply)
- **THEN** the system resolves the thread from that message's `thread_ts`
- **AND** aborts any in-flight request associated with that thread
- **AND** sets the thread's session `attentionLevel` to `"off"`

#### Scenario: Stop reaction on message with no in-flight work

- **WHEN** a user adds the stop emoji to a thread with no in-flight Claude work
- **THEN** the system still disengages the thread (sets `attentionLevel = "off"`)
- **AND** returns without error (no-op on the abort side)

#### Scenario: Stop reaction on already-disengaged thread

- **WHEN** a user adds the stop emoji to a thread whose session already has `attentionLevel === "off"` and no in-flight work
- **THEN** the handler is idempotent (no error, no status change, no double-abort)

#### Scenario: Stop reaction when feature is disabled

- **WHEN** `config.reactions.stop` is unset, `null`, or an empty string
- **AND** a user adds any emoji to any message
- **THEN** the stop-reaction handler takes no action
- **AND** the system behaves as if the stop feature did not exist

#### Scenario: Stop emoji matches exactly

- **WHEN** a user adds an emoji whose name does not exactly match `config.reactions.stop`
- **THEN** the stop-reaction handler takes no action
- **AND** the event continues through other reaction handlers normally

#### Scenario: Stop reaction on message in channel the bot cannot read

- **WHEN** a user adds the stop emoji to a message and the bot lacks access to the channel
- **THEN** the system silently takes no action (matches existing reaction-handler behavior)

#### Scenario: Stop reaction applies regardless of reactor identity

- **WHEN** any user who can see the thread adds the stop emoji
- **THEN** the stop action applies (no role or session-ownership check)

### Requirement: Stop Reaction Configuration

The system SHALL accept an optional `reactions.stop` field in `config.json` specifying the emoji name (without colons) to treat as the stop trigger. The field SHALL default to `"octagonal_sign"` on new installs and SHALL be added to existing installs via a boot migration.

#### Scenario: Default value on new install

- **WHEN** a fresh Clack install is initialized
- **THEN** `config.reactions.stop` is set to `"octagonal_sign"` by default

#### Scenario: Custom stop emoji

- **WHEN** an admin sets `config.reactions.stop` to a custom emoji name (e.g., `"clack-stop"`)
- **THEN** the stop-reaction handler listens for that emoji name
- **AND** the default `octagonal_sign` no longer triggers stop behavior

#### Scenario: Explicit disable

- **WHEN** `config.reactions.stop` is set to `null` or an empty string
- **THEN** the stop-reaction feature is disabled

#### Scenario: Config validation

- **WHEN** `config.reactions.stop` is present and not null/empty
- **THEN** it MUST be a string containing an emoji name without surrounding colons
- **AND** validation rejects values that include `:` or whitespace

#### Scenario: Migration adds default to existing config

- **WHEN** a boot migration runs against a config that does not have `reactions.stop` defined
- **THEN** the migration adds `reactions.stop: "octagonal_sign"`
- **AND** persists the updated config

#### Scenario: Migration is idempotent

- **WHEN** the migration runs against a config that already has `reactions.stop` defined (including `null`)
- **THEN** the migration leaves the field unchanged
