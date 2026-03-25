# auto-respond Specification

## Purpose
Automated response trigger mode. Watches configured channels for matching messages (by user/bot filter or keyword) and automatically triggers a Clack response as a thread reply. Rules are managed by admins from the Home Tab.

## Requirements
### Requirement: Auto-Respond Rule Persistence

The system SHALL persist auto-respond rules in `data/state/auto-respond.json` with in-memory caching.

#### Scenario: Rule file structure
- **WHEN** rules are saved
- **THEN** the file contains a JSON object with a `rules` array
- **AND** each rule has: `id` (string), `channels` (string[]), `userFilters` (string[], optional), `extraContext` (string, optional), `enabled` (boolean)

#### Scenario: Load rules on first access
- **WHEN** rules are accessed for the first time
- **THEN** the system reads from `data/state/auto-respond.json`
- **AND** caches the result in memory
- **AND** returns an empty rules array if the file does not exist

#### Scenario: Persist rules on change
- **WHEN** a rule is created, updated, or deleted
- **THEN** the system writes the updated rules to disk
- **AND** updates the in-memory cache

#### Scenario: Concurrent rule modifications
- **WHEN** two admins modify rules simultaneously
- **THEN** last-write-wins semantics apply
- **AND** the file is always valid JSON (no partial writes or corruption)

### Requirement: Auto-Respond Rule Matching

The system SHALL evaluate incoming messages against active auto-respond rules, filtering out non-message events and triggering on the first matching rule only.

#### Scenario: Match by channel only (no user filters)
- **WHEN** a top-level message arrives in a channel that matches a rule with no `userFilters`
- **AND** the rule is enabled
- **THEN** the system triggers a response

#### Scenario: Match by channel and user filter
- **WHEN** a top-level message arrives in a channel that matches a rule with `userFilters`
- **AND** the message author's `user` is in `userFilters`
- **AND** the rule is enabled
- **THEN** the system triggers a response

#### Scenario: No match when user filter excludes author
- **WHEN** a message arrives in a channel that matches a rule with `userFilters`
- **AND** the message author's `user` is not in `userFilters`
- **THEN** the system does NOT trigger a response

#### Scenario: Disabled rule does not match
- **WHEN** a message arrives in a channel that matches a disabled rule
- **THEN** the system does NOT trigger a response

#### Scenario: Ignore own messages
- **WHEN** a message is posted by Clack itself (matching the bot's own user ID)
- **THEN** the system does NOT trigger a response regardless of rules

#### Scenario: Ignore message subtypes
- **WHEN** a message event has a subtype (e.g., `message_changed`, `message_deleted`, `channel_join`, `bot_message`)
- **THEN** the system does NOT trigger a response
- **AND** only messages with no subtype (regular new messages) are evaluated against rules

#### Scenario: Ignore thread replies
- **WHEN** a message event has a `thread_ts` field (indicating it is a reply in a thread)
- **THEN** the system does NOT trigger a response
- **AND** only top-level channel messages are evaluated against rules

#### Scenario: First matching rule wins
- **WHEN** a message matches multiple active rules (e.g., one channel-only rule and one channel+user rule)
- **THEN** the system triggers exactly one response
- **AND** stops evaluating further rules after the first match

#### Scenario: No deduplication of similar messages
- **WHEN** multiple messages in the same channel match the same rule within a short time window (e.g., Sentry posting the same error 10 times)
- **THEN** each message triggers an independent response
- **AND** no deduplication is applied (deduplication is explicitly out of scope for v1)

### Requirement: Auto-Respond Message Handler

The system SHALL register a `message` event handler that processes matched messages through the standard query flow.

#### Scenario: Handler registered when enabled
- **WHEN** the Slack app initializes
- **AND** `autoRespond.enabled` is `true` in config
- **THEN** the system registers the auto-respond message handler

#### Scenario: Trigger response on match
- **WHEN** a message matches an active rule
- **THEN** the system calls `processMessage()` with:
  - `userId` set to the message author's user ID (or `"auto-respond"` as fallback if no user field)
  - `triggerType` set to `"autoRespond"`
  - `channelId` set to the message's channel
  - `messageTs` set to the message's timestamp
  - `messageText` set to the message's text content
  - `threadTs` left undefined (response starts a new thread)

#### Scenario: Include attachments and files
- **WHEN** a matched message contains attachments or files
- **THEN** the system extracts attachment content and passes it to `processMessage()`

#### Scenario: Message with empty text but attachments
- **WHEN** a matched message has no text content (empty string or undefined) but has attachments or files
- **THEN** the system uses a fallback message text such as "Respond to this message" for `messageText`
- **AND** attachment and file content is still extracted and passed to `processMessage()`

#### Scenario: No rules exist
- **WHEN** no auto-respond rules exist
- **AND** a message event is received
- **THEN** the handler returns immediately without processing

### Requirement: Auto-Respond Trigger Type

The system SHALL support `"autoRespond"` as a trigger type throughout the processing pipeline, with early-exit handling in functions that index into trigger-specific config.

#### Scenario: TriggerType union includes autoRespond
- **WHEN** the system defines the `TriggerType` type
- **THEN** it includes `"autoRespond"` as a valid value

#### Scenario: Changes Workflow disabled for autoRespond
- **WHEN** the trigger type is `"autoRespond"`
- **THEN** the Changes Workflow is NOT available for the session
- **AND** Claude does NOT receive change proposal tools
- **AND** `isChangesEnabledForTrigger()` SHALL return `false` before attempting to access `config[triggerType]` (since `"autoRespond"` is not a key of the Config object)

#### Scenario: Response posted as thread reply
- **WHEN** the trigger type is `"autoRespond"`
- **AND** Claude calls `submit_response`
- **THEN** the response is posted as a thread reply on the triggering message

#### Scenario: Delivery context for auto-respond
- **WHEN** the system builds the delivery context prompt for a session with triggerType `"autoRespond"`
- **THEN** the prompt SHALL indicate this is an automated response to a channel message
- **AND** the prompt SHALL NOT include `accept`, `reject`, or `send_to_thread` action guidance

#### Scenario: Extra context injected into response
- **WHEN** a matched rule has an `extraContext` field
- **THEN** the extra context is prepended to the message text sent to `processMessage()`

#### Scenario: Auto-respond sessions are not cancellable
- **WHEN** an auto-respond session is in progress
- **THEN** it is NOT registered in the in-flight request tracker
- **AND** it cannot be cancelled by editing or deleting the triggering message

### Requirement: Auto-Respond Error Handling

The system SHALL handle errors during auto-respond processing without user-facing notification. The error catch MUST occur in the auto-respond handler itself, wrapping the `processMessage()` call — NOT inside the shared pipeline, which has its own error handling that posts to threads and DMs.

#### Scenario: Processing error during auto-respond
- **WHEN** `processMessage()` throws an error for an auto-respond trigger
- **THEN** the auto-respond handler catches the error at the handler level
- **AND** logs the error with the rule ID and channel for debugging
- **AND** does NOT allow the error to propagate to `executeAndDeliver`'s internal `handleError()`
- **AND** does NOT crash the event handler

### Requirement: Auto-Respond Logging

The system SHALL log auto-respond trigger events for operational monitoring.

#### Scenario: Log on successful trigger
- **WHEN** a message matches an auto-respond rule and triggers a response
- **THEN** the system logs the event at info level with: channel ID, matched rule ID, and message author

### Requirement: Auto-Respond Rule Management

The system SHALL provide CRUD operations for auto-respond rules.

#### Scenario: Create a rule
- **WHEN** an admin creates a new rule with channels and optional user filters
- **THEN** the system generates a unique rule ID
- **AND** saves the rule with `enabled: true` by default
- **AND** persists the updated rules to disk

#### Scenario: Update a rule
- **WHEN** an admin updates an existing rule's channels or user filters
- **THEN** the system updates the rule in place
- **AND** persists the updated rules to disk

#### Scenario: Toggle a rule
- **WHEN** an admin toggles a rule's enabled state
- **THEN** the system flips the `enabled` boolean
- **AND** persists the updated rules to disk

#### Scenario: Delete a rule
- **WHEN** an admin deletes a rule
- **THEN** the system removes the rule from the rules array
- **AND** persists the updated rules to disk
