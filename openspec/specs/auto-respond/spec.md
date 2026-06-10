# auto-respond Specification

## Purpose
Automated response trigger mode. Watches configured channels for matching messages (by user/bot filter or keyword) and automatically triggers a Clack response as a thread reply. Rules are managed by admins from the Home Tab.
## Requirements
### Requirement: Auto-Respond Rule Persistence

The system SHALL persist auto-respond rules in `data/state/auto-respond.json` with in-memory caching.

#### Scenario: Rule file structure
- **WHEN** rules are saved
- **THEN** the file contains a JSON object with a `rules` array
- **AND** each rule has: `id` (string), `channels` (string[]), `userFilters` (string[], optional), `keywords` (string[], optional), `extraContext` (string, optional), `preAnalysisContext` (string, optional), `enabled` (boolean)

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
- **THEN** the system triggers a response (subject to pre-analysis if configured)

#### Scenario: Match by channel and user filter
- **WHEN** a top-level message arrives in a channel that matches a rule with `userFilters`
- **AND** the message author's `user` is in `userFilters`
- **AND** the rule is enabled
- **THEN** the system triggers a response (subject to pre-analysis if configured)

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

#### Scenario: Thread replies bypass rule matching
- **WHEN** a message event has a `thread_ts` field (indicating it is a reply in a thread)
- **THEN** the system does NOT evaluate the message against auto-respond rules
- **AND** instead follows the thread auto-respond path (session-based, see Thread Auto-Respond requirement)

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
- **WHEN** the system builds the delivery context prompt for a session with triggerType `"autoRespond"` or `"threadReply"`
- **THEN** the prompt SHALL indicate this is an automated response to a channel message
- **AND** the prompt SHALL NOT include `accept`, `reject`, or `send_to_thread` action guidance
- **AND** the prompt SHALL include guidance that Claude can use `skip_response` when the conversation doesn't need a Clack response (e.g., users talking to each other, question already answered)

#### Scenario: Extra context injected into response
- **WHEN** a matched rule has an `extraContext` field
- **THEN** the extra context is prepended to the message text sent to `processMessage()`

#### Scenario: Auto-respond sessions are not cancellable
- **WHEN** an auto-respond session is in progress
- **THEN** it is NOT registered in the in-flight request tracker
- **AND** it cannot be cancelled by editing or deleting the triggering message

#### Scenario: Skipped auto-respond leaves no trace
- **WHEN** Claude skips a response in an auto-respond session
- **THEN** the streamer message is deleted from the channel thread
- **AND** no session is persisted
- **AND** from the user's perspective, Clack never responded

### Requirement: Thread Auto-Respond

The system SHALL support automatic responses to thread replies in threads with existing Clack sessions, gated by tracking state and pre-analysis to avoid responding to noise. When a Claude run is already active for the same thread (per the `active-runs-registry` capability), incoming messages SHALL be delivered to that run via `handle.sendUpdate(text)` instead of being dropped or spawned as a parallel run.

#### Scenario: Thread reply in an engaged session

- **WHEN** a non-bot message arrives in a thread
- **AND** `threadAutoRespond` is not `false` in config
- **AND** a Clack session exists for that thread
- **AND** the session has `attentionLevel !== "off"` (the session is engaged; default `"medium"` for new/legacy sessions)
- **THEN** the system runs pre-analysis (see auto-respond-pre-analysis spec) to determine whether to respond
- **AND** if pre-analysis returns `"respond"`, calls `processMessage()` with `triggerType` set to `"threadReply"`
- **AND** if pre-analysis returns `"stop"`, sets `attentionLevel = "off"` on the session and does NOT call `processMessage()`

#### Scenario: Thread reply in a disengaged session

- **WHEN** a non-bot message arrives in a thread
- **AND** a Clack session exists with `attentionLevel === "off"`
- **THEN** the system does NOT run pre-analysis
- **AND** does NOT trigger a response
- **AND** logs at debug level that the thread is disengaged

#### Scenario: Thread reply with no session

- **WHEN** a message arrives in a thread that has no existing Clack session
- **THEN** the system does NOT trigger a response

#### Scenario: Thread auto-respond disabled

- **WHEN** `threadAutoRespond` is `false` in config
- **THEN** the system does NOT trigger responses to any thread replies

#### Scenario: Bot messages in threads are ignored

- **WHEN** a message in a thread has a `bot_id` field
- **THEN** the system does NOT trigger a response

#### Scenario: Active run receives the reply via sendUpdate

- **WHEN** a thread reply triggers auto-respond
- **AND** the active-runs registry contains a `ClaudeRunHandle` for the thread (or, for DMs, for the per-user DM key)
- **THEN** `processMessage()` consults the registry and calls `handle.sendUpdate(text)` to push the message into the live run
- **AND** adds a `:speech_balloon:` reaction to the user's message as visible ack
- **AND** does NOT create a new streamer or new session resume
- **AND** the active run's existing streamer continues to render its in-flight response (no second response is rendered for the queued message; the model folds the new context into its turn-after-current)

#### Scenario: sendUpdate rejection falls through to fresh spawn

- **WHEN** auto-respond invokes `handle.sendUpdate(text)` and the call rejects (e.g., the run just settled)
- **THEN** the handler falls through to the existing fresh-spawn path
- **AND** spawns a new run that resumes from the persisted `sdkSessionId`

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

The system SHALL provide CRUD operations for auto-respond rules. Rules MAY be managed from the Home Tab or from chat via the auto-respond rule tools (see `auto-respond-rule-tools`). Both surfaces mutate the same store via the same CRUD functions in `src/autoRespond.ts` and MUST produce identical persisted state for equivalent operations.

Update operations SHALL follow partial-patch semantics: fields omitted from the update patch are preserved, fields present with an empty string or empty array are explicitly cleared.

#### Scenario: Create a rule
- **WHEN** an admin creates a new rule with channels and optional user filters
- **THEN** the system generates a unique rule ID
- **AND** saves the rule with `enabled: true` by default
- **AND** persists the updated rules to disk

#### Scenario: Create a rule with pre-analysis context
- **WHEN** an admin creates a new rule with a `preAnalysisContext` value
- **THEN** the system saves the rule with the `preAnalysisContext` field
- **AND** pre-analysis is active for that rule

#### Scenario: Update a rule preserves omitted fields
- **WHEN** an admin updates an existing rule with a partial patch (some fields omitted)
- **THEN** the omitted fields retain their prior values
- **AND** the provided fields are applied
- **AND** the updated rules are persisted to disk

#### Scenario: Update a rule with all fields behaves as full replacement
- **WHEN** an admin updates a rule and supplies values for every optional field
- **THEN** the rule's optional fields reflect exactly the supplied values (mirroring the Home Tab modal submission flow)
- **AND** the updated rules are persisted to disk

#### Scenario: Clear pre-analysis context via explicit empty value
- **WHEN** an admin updates a rule with `preAnalysisContext: ""`
- **THEN** the system removes the `preAnalysisContext` field from the rule
- **AND** pre-analysis is no longer active for that rule

#### Scenario: Omitting pre-analysis context in a patch does not clear it
- **GIVEN** a rule with `preAnalysisContext` currently set
- **WHEN** an admin updates the rule with a patch that does not include a `preAnalysisContext` key
- **THEN** the rule's `preAnalysisContext` is unchanged

#### Scenario: Toggle a rule
- **WHEN** an admin toggles a rule's enabled state
- **THEN** the system flips the `enabled` boolean
- **AND** persists the updated rules to disk

#### Scenario: Delete a rule
- **WHEN** an admin deletes a rule
- **THEN** the system removes the rule from the rules array
- **AND** persists the updated rules to disk

### Requirement: Auto-Respond Rule UI — Pre-Analysis Context

The Home Tab "Edit Rule" modal SHALL include an optional text input for pre-analysis context.

#### Scenario: Pre-analysis context field displayed
- **WHEN** an admin opens the Add Rule or Edit Rule modal
- **THEN** the modal displays a "Pre-analysis context" plain text input field
- **AND** the field is optional (not required)
- **AND** the field placeholder explains its purpose (e.g., "Only respond if this is an actionable error — leave empty to skip pre-analysis")

#### Scenario: Pre-analysis context field pre-populated on edit
- **WHEN** an admin opens the Edit Rule modal for a rule that has `preAnalysisContext` set
- **THEN** the field is pre-populated with the existing value

#### Scenario: Pre-analysis context saved on submission
- **WHEN** an admin submits the modal with a non-empty pre-analysis context value
- **THEN** the value is saved to the rule's `preAnalysisContext` field

#### Scenario: Pre-analysis context cleared on submission
- **WHEN** an admin submits the modal with an empty pre-analysis context value
- **THEN** the `preAnalysisContext` field is removed from the rule

#### Scenario: Pre-analysis context displayed in rule summary
- **WHEN** the Home Tab renders a rule that has `preAnalysisContext` set
- **THEN** the rule summary indicates that pre-analysis is active (e.g., "Pre-analysis" label)

### Requirement: Direct-to-Channel Delivery via post_top_level

When an auto-respond rule's `extraContext` (or the channel's implicit convention) calls for the response to be posted at channel top-level rather than in the triggering thread, the system SHALL provide a structured signal — the `post_top_level: true` flag on `submit_response` — so Claude can route delivery without relying on `post_to` workarounds that risk duplication.

#### Scenario: Rule's extra context directs post to channel

- **GIVEN** an auto-respond rule whose `extraContext` instructs Claude to post directly to the channel rather than in the thread
- **WHEN** Claude handles a matching message and prepares a response
- **THEN** the delivery-context prompt for that session documents `post_top_level: true` as the correct mechanism
- **AND** instructs Claude NOT to combine it with a `post_to` action targeting the same channel (would duplicate)

#### Scenario: No duplicate messages when post_top_level is used correctly

- **GIVEN** Claude sets `post_top_level: true` on a response in an auto-respond session
- **WHEN** the tool delivers the response
- **THEN** exactly one message appears in Slack — a top-level post in the session's channel
- **AND** no thread-reply copy of the same content is posted

#### Scenario: post_to still available for cross-channel broadcasts

- **WHEN** Claude needs to post to a DIFFERENT channel (or a specific thread elsewhere) in addition to or instead of replying
- **THEN** Claude uses `post_to` with an explicit `channel` (and optionally `thread_ts`) — unaffected by `post_top_level`
- **AND** the two mechanisms compose: `post_top_level: true` delivers the primary response to the session's channel top-level while `post_to` can broadcast to other destinations

### Requirement: Follow-Up Session for Top-Level Posts

When a response is delivered top-level via `post_top_level: true`, the system SHALL create a new session tied to the posted message's thread so replies route to their own conversational context. The follow-up session inherits "similar context" from the parent session (channel, channelName, `additionalSystemPrompt`, user identity) but has its own independent lifecycle — its own `attentionLevel` state, its own pre-analysis history, its own disengage decisions.

#### Scenario: Top-level delivery creates a new session for its own thread

- **GIVEN** an auto-respond session for channel C001 / thread T_original with `additionalSystemPrompt` carrying the rule's extra context
- **WHEN** Claude calls `submit_response` with `post_top_level: true` and the deliver callback posts successfully, returning ts T_new
- **THEN** a new session is created with `channelId: C001`, `threadTs: T_new`, `messageTs: T_new`, `triggerType: "autoRespond"`
- **AND** the new session's `additionalSystemPrompt`, `channelName`, `userId`, `username`, `displayName` are copied from the parent session
- **AND** `attentionLevel: "medium"` (default for new sessions)

#### Scenario: Replies to the top-level post route to the follow-up session

- **GIVEN** a follow-up session exists for `(C001, T_new)`
- **WHEN** a user replies in the thread of the top-level post (thread_ts = T_new)
- **THEN** the thread-reply auto-respond path resolves the follow-up session via `findSessionByThread(C001, T_new)`
- **AND** pre-analysis + response handling proceed against the follow-up session — independent of the parent

#### Scenario: Disengaging one session does not affect the other

- **GIVEN** parent session and follow-up session both exist and both have `attentionLevel !== "off"`
- **WHEN** Claude disengages the follow-up session (e.g., via `attention_level: "off"` on a reply to the top-level post)
- **THEN** the follow-up session's `attentionLevel` becomes `"off"`
- **AND** the parent session's `attentionLevel` is unchanged — replies in the parent thread still go through auto-respond

#### Scenario: Follow-up session creation failure does not block delivery

- **GIVEN** `chat.postMessage` succeeds but `createSession` throws (e.g., disk full)
- **WHEN** the deliver callback returns
- **THEN** it returns `{ ok: true, ts }` — delivery is not failed
- **AND** the error is logged at warn level
- **AND** Claude's response is still considered successful — follow-up tracking is best-effort

#### Scenario: Follow-up session defaults to engaged state

- **GIVEN** a follow-up session is created for a top-level post
- **WHEN** the session is created
- **THEN** `attentionLevel: "medium"` (the default for new sessions)
- **AND** replies to the top-level post are auto-followed via the thread-reply auto-respond path

### Requirement: Auto-respond rules load is schema-driven

`loadRules` SHALL parse `auto-respond` state against an `AutoRespondState` zod schema rather than a blind `JSON.parse(content) as Partial<AutoRespondState>` cast, preserving its graceful contract: a missing file, invalid JSON, or shape mismatch SHALL log and return `[]` (no rules), never throw. Optional/legacy fields SHALL be modeled so existing on-disk state round-trips.

#### Scenario: Corrupt state degrades to no rules

- **WHEN** the auto-respond state file is absent, not valid JSON, or fails schema validation
- **THEN** `loadRules` returns `[]` and logs, exactly as today

#### Scenario: Existing saved rules load unchanged

- **WHEN** a state file written by a prior build (including partial/optional fields) is loaded
- **THEN** the returned `AutoRespondRule[]` is identical to the pre-migration result

