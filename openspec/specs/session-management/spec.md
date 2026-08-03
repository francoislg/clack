# session-management Specification

## Purpose
TBD - created by archiving change add-slack-reaction-bot. Update Purpose after archive.
## Requirements
### Requirement: Session Creation
The system SHALL create a unique session for each triggered reaction.

#### Scenario: New session on trigger
- **WHEN** a user adds the trigger reaction to a message
- **THEN** the system creates a new session with a unique ID
- **AND** creates a directory at `data/sessions/{session-id}/`
- **AND** initializes session state in `context.json`

#### Scenario: Session ID format
- **WHEN** a session is created
- **THEN** the session ID includes the Slack channel, message timestamp, and user ID
- **AND** ensures uniqueness across concurrent requests

### Requirement: Unified Conversation Log

The system SHALL persist a session's conversation as a structured **`trigger`** metadata object plus a temporal **`messages: SessionMessage[]`** array on `SessionContext`. The trigger describes what created the session; `messages[]` is a pure log of turns that happened after, starting at index 0 with Clack's first assistant turn.

#### Scenario: Trigger shape is a discriminated union

- **WHEN** a session is persisted
- **THEN** `context.json` includes a `trigger` object whose `type` is one of `"reactions"`, `"mentions"`, `"directMessages"`, `"autoRespond"`, or `"scheduled"`
- **AND** for `"reactions"`, `trigger` includes `userId`, `emoji`, `messageTs`, `messageText`, and optional `imageFiles`
- **AND** for `"mentions"`, `"directMessages"`, `"autoRespond"`, `trigger` includes `userId`, `messageTs`, `messageText`, and optional `imageFiles`; `"autoRespond"` additionally carries optional `ruleName` and optional `preAnalysis`
- **AND** for `"scheduled"`, `trigger` includes `prompt`, optional `jobId`, and optional `preAnalysis`; no `userId` / `messageTs` / `messageText` fields
- **AND** `messageTs` on the trigger is the Slack timestamp of the triggering message (for user-first types)

#### Scenario: Messages array shape

- **WHEN** a session has had at least one assistant turn
- **THEN** `context.json` contains a `messages` array
- **AND** each entry is one of:
  - a `SessionUserMessage` with `role: "user"`, `source` of `"reply" | "choice" | "followup"`, `text`, `ts`, and — only when `source: "choice"` — a `value`
  - a `SessionAssistantMessage` with `role: "assistant"`, `ts`, and optional `text`, `payload`, `toolCalls`, `skipped`, `disengaged`, `postedTopLevel`, `error`, `preAnalysis`
- **AND** `messages[0]` is ALWAYS a `SessionAssistantMessage` (Clack's first delivered response)
- **AND** entries appear in chronological order by `ts`
- **AND** NO `SessionUserMessage` has `source: "initial"` or `source: "refinement"` (those sources are removed)

#### Scenario: Empty messages on new session

- **WHEN** a session is created but Claude has not yet delivered a response
- **THEN** `messages` is an empty array
- **AND** the `trigger` carries all metadata about the triggering event
- **AND** the session is a valid on-disk entity (e.g., a `find_session_transcript` call on it returns `totalMessages: 0`)

#### Scenario: User reply appended

- **WHEN** a user posts a thread reply on an existing session
- **THEN** a `SessionUserMessage` with `source: "reply"` is appended to `messages` with the message text and current timestamp
- **AND** the trigger is untouched

#### Scenario: Choice button press appended as structured user message

- **WHEN** a user presses a choice action button
- **THEN** a `SessionUserMessage` with `source: "choice"` is appended with `text` set to the choice label, `value` set to the machine value, and the current timestamp

#### Scenario: Followup button press appended as structured user message

- **WHEN** a user presses a followup action button
- **THEN** a `SessionUserMessage` with `source: "followup"` is appended with `text` set to the followup prompt and the current timestamp

#### Scenario: Assistant turn appended after submit_response

- **WHEN** a query turn completes with a successful `submit_response` call
- **THEN** a `SessionAssistantMessage` is appended to `messages` with `payload` set to the `SubmitResponsePayload`, `ts` set to the completion timestamp, and `toolCalls` set to the tool call records for this turn
- **AND** previous assistant messages in `messages` are NOT overwritten or removed

#### Scenario: Skipped assistant turn appended without payload

- **WHEN** a query turn completes via `submit_response` with `skip_response: true`
- **THEN** a `SessionAssistantMessage` is appended with `skipped: true`, no `payload`, and `toolCalls` populated
- **AND** if `attention_level: "off"` was also set, `disengaged: true` is included

#### Scenario: Top-level post recorded on assistant turn

- **WHEN** an assistant turn is posted at the top of the channel via `post_top_level: true`
- **THEN** the appended `SessionAssistantMessage` includes `postedTopLevel: true`

#### Scenario: Errored turn appended as assistant message with error

- **WHEN** a query turn fails with an error attributable to the turn (not a session-level failure)
- **THEN** a `SessionAssistantMessage` with `error` populated is appended

#### Scenario: Pre-analysis verdict captured per autoRespond turn

- **WHEN** a query turn is driven by autoRespond (either the initial session-creating trigger or a threadReply continuation)
- **AND** the pre-analysis gate ran and produced a verdict
- **THEN** the verdict is stored as `preAnalysis` on the appended `SessionAssistantMessage`
- **AND** for session-creating autoRespond triggers the same verdict is also stored on `trigger.preAnalysis`

#### Scenario: Session reuse always appends — no abort-edit rewrite

- **WHEN** a handler fires on an existing session (found via `findSessionByThread`)
- **THEN** a `SessionUserMessage` with `source: "reply"` is appended with the new message text
- **AND** the trigger's `messageText` is NOT mutated
- **AND** `messages[0]` is NOT mutated


### Requirement: Thread Context Delta Tracking

The system SHALL track the last-seen thread timestamp to enable delta-based thread context injection on resumed sessions.

#### Scenario: Last seen timestamp updated after query

- **WHEN** a `clackSession()` query completes successfully
- **THEN** the session stores `lastSeenThreadTs` as the timestamp of the most recent thread message fetched when building the prompt for this query (i.e., at query start, before Claude begins executing)
- **AND** persists it to `context.json`

#### Scenario: Delta thread context on resume

- **WHEN** a follow-up query resumes an SDK session (sdkSessionId is present)
- **THEN** the system fetches only thread messages newer than `lastSeenThreadTs`
- **AND** injects only those messages as additional context in the prompt

#### Scenario: Full thread context fallback

- **WHEN** a query does not resume an SDK session (no sdkSessionId, or resume failed)
- **THEN** the system injects the full thread context as today
- **AND** `lastSeenThreadTs` is not used for filtering

### Requirement: Session Timeout

The system SHALL use age-based eviction instead of activity-based timeout for session cleanup.

#### Scenario: Sessions persist indefinitely during normal use

- **WHEN** a session is created
- **THEN** it remains accessible regardless of inactivity duration
- **AND** re-engaging the thread always finds the existing session

#### Scenario: Age-based eviction

- **WHEN** a session's creation date exceeds the configured maximum age (default 30 days)
- **AND** the session has no active change execution
- **THEN** the session is eligible for eviction by the cleanup job

#### Scenario: Active change sessions excluded from eviction

- **WHEN** a session has an `activeChange` with a non-terminal status
- **THEN** the session is never evicted regardless of age

#### Scenario: Maximum age configurable

- **WHEN** the system reads configuration
- **THEN** it uses `sessions.maxAgeDays` for eviction threshold
- **AND** defaults to 30 days if not specified

### Requirement: Session Cleanup

The system SHALL periodically clean up old sessions based on age.

#### Scenario: Cleanup job runs on interval

- **WHEN** the configured cleanup interval has elapsed
- **THEN** the system scans `data/sessions/` for sessions exceeding the maximum age
- **AND** removes session directories that are eligible for eviction
- **AND** removes corresponding entries from the in-memory thread index

#### Scenario: Cleanup interval configurable

- **WHEN** the system reads configuration
- **THEN** it uses `cleanupIntervalMinutes` for cleanup scheduling
- **AND** defaults to 60 minutes if not specified

### Requirement: Active Change Execution State

The system SHALL support optional active change execution state on a session, representing an in-progress code change in the thread.

#### Scenario: Session with active change

- **WHEN** a change workflow starts in a thread
- **THEN** the session's `activeChange` field is populated with: branch name, repo name, description, worktree info, status, start time, and last activity time
- **AND** `activeChange` is held in memory only (not persisted to `context.json`)

#### Scenario: Session without active change

- **WHEN** a thread has no active change execution
- **THEN** the session's `activeChange` field is `undefined`
- **AND** the session functions normally for Q&A

#### Scenario: Active change has PR

- **WHEN** a PR is created during change execution
- **THEN** `activeChange.prUrl` is set to the PR URL
- **AND** the PR URL is included in prompt context for Claude

#### Scenario: Active change status transitions

- **WHEN** the change execution progresses
- **THEN** `activeChange.status` transitions through: `executing` → `pr_created` → `reviewing` / `merging` → `completed` / `failed`
- **AND** `activeChange.lastActivityAt` is updated on each transition

#### Scenario: Active change cleared on completion

- **WHEN** a change execution completes (merged, closed, or failed)
- **THEN** `activeChange` is set to `undefined` on the session
- **AND** the session remains accessible for future interactions
- **AND** the worktree is cleaned up

### Requirement: In-Memory Thread-to-Session Index

The system SHALL maintain an in-memory index mapping `channel:threadTs` to session IDs for O(1) thread-based lookups.

#### Scenario: Index populated on session creation

- **WHEN** a new session is created
- **THEN** the index maps `{channelId}:{threadTs}` → `sessionId`

#### Scenario: Index used for lookup

- **WHEN** `findSessionByThread` is called
- **THEN** it first checks the in-memory index
- **AND** if found, loads the session from disk using the session ID
- **AND** does NOT scan all session directories

#### Scenario: Index miss falls back to disk scan

- **WHEN** the in-memory index does not contain a mapping for the thread
- **THEN** the system scans `data/sessions/` for a matching session
- **AND** if found, populates the index for future lookups

#### Scenario: Index populated at startup

- **WHEN** the application starts
- **THEN** the index is populated lazily on first lookup or eagerly from existing sessions

### Requirement: Session Identification
The system SHALL identify sessions by the originating message and user. Sessions are no longer identified via ephemeral message interactions.

#### Scenario: Same message, same user continues session
- **WHEN** a user interacts with buttons on a streamed response
- **THEN** the system looks up the existing session for that message and user

#### Scenario: Different user creates new session
- **WHEN** a different user adds the trigger reaction to the same message
- **THEN** the system creates a separate session for that user
- **AND** each user has an independent conversation

### Requirement: Session Storage Directory
The system SHALL store all sessions under `data/sessions/`.

#### Scenario: Sessions directory creation
- **WHEN** the system starts
- **THEN** it creates `data/sessions/` if it does not exist
- **AND** ensures proper permissions for the directory

#### Scenario: Session directory contents
- **WHEN** a session is active
- **THEN** its directory contains at minimum `context.json`
- **AND** may contain additional files created by Claude Code

### Requirement: Session Restoration
The system SHALL restore sessions from disk when needed after an app restart. Session restoration no longer involves ephemeral-specific handling.

#### Scenario: Lazy session restoration
- **WHEN** a user clicks a button (choice, followup, change action) after an app restart
- **AND** the session is not in memory
- **THEN** the system loads the session from `data/sessions/{session-id}/context.json`
- **AND** restores session info to memory
- **AND** the restored `SessionInfo` does NOT include `isEphemeral`
- **AND** continues processing the action normally

#### Scenario: Session info reconstruction from sessionId
- **WHEN** a user clicks a button after an app restart
- **AND** the session cannot be found on disk (expired or deleted)
- **THEN** the system parses the sessionId to extract channelId, messageTs, and userId
- **AND** reconstructs minimal session info to enable button handling

### Requirement: Expired Session Recreation
The system SHALL recreate expired sessions from Slack context when possible. Expired session scenarios no longer reference ephemeral messages.

#### Scenario: Choice or followup with expired session
- **WHEN** a user clicks a choice or followup button on an expired session
- **THEN** the system fetches the original message and thread context from Slack
- **AND** creates a new session with the fetched data
- **AND** injects the choice value or followup prompt into the new query

### Requirement: Thread Message Structure
The system SHALL store thread messages with optional user identity fields and optional reaction data.

#### Scenario: Thread message with user names
- **WHEN** `fetchUserNames` is enabled
- **AND** thread context is captured
- **THEN** each `ThreadMessage` includes:
  - `text`: message content
  - `userId`: Slack user ID
  - `isBot`: boolean
  - `ts`: message timestamp
  - `username`: Slack handle (optional)
  - `displayName`: User's display name (optional)
  - `reactions`: array of `MessageReaction` (optional, present when the message has reactions)
- **AND** each `MessageReaction` includes `emoji` (string), `userIds` (string array), and `usernames` (string array, resolved from user cache)

#### Scenario: Thread message without user names
- **WHEN** `fetchUserNames` is disabled
- **THEN** `ThreadMessage` does not include `username` or `displayName` fields
- **AND** `reactions` may still be present but without resolved `usernames`
- **AND** existing behavior is preserved

#### Scenario: Thread message with no reactions
- **WHEN** a message has no reactions in the Slack API response
- **THEN** the `reactions` field is omitted from the `ThreadMessage`

#### Scenario: Reactions formatted in thread context prompt
- **WHEN** thread context is formatted for the system prompt
- **AND** a message has reactions
- **THEN** a `[reactions: ...]` line is appended after the message text
- **AND** each reaction is formatted as `:emoji: by @username, @username`
- **AND** multiple reactions are separated by semicolons

#### Scenario: No reactions line for unreacted messages
- **WHEN** thread context is formatted for the system prompt
- **AND** a message has no reactions
- **THEN** no `[reactions: ...]` line is appended

### Requirement: Channel Post Tracking
The system SHALL track the message timestamp of answers posted to the original channel thread.

#### Scenario: Channel post timestamp stored
- **WHEN** a synthesized answer is accepted and posted to the original channel thread
- **THEN** the session stores the channel message timestamp as `channelPostTs`
- **AND** this enables future "Update original post" actions via `chat.update`

#### Scenario: Channel post timestamp updated on re-post
- **WHEN** a user posts a new reply to the channel after a post-accept refinement
- **THEN** the session updates `channelPostTs` to the new message timestamp

### Requirement: Synthetic User Identity for Auto-Respond

The system SHALL support sessions with a synthetic user identity for auto-respond triggers when no real user ID is available.

#### Scenario: Session created with synthetic user ID
- **WHEN** an auto-respond rule triggers on a message with no `user` field
- **THEN** the session is created with `userId` set to `"auto-respond"`

#### Scenario: Role resolution for synthetic user
- **WHEN** the system resolves the role for user ID `"auto-respond"`
- **THEN** role resolution returns `"member"` (no entry in roles)
- **AND** user-tier instructions apply

#### Scenario: User info lookup gracefully handles synthetic user
- **WHEN** the system attempts to fetch Slack user info for `"auto-respond"`
- **THEN** `getUserInfo()` SHALL detect the synthetic user ID and return `{ userId: "auto-respond", displayName: "Auto-Respond", username: undefined }`
- **AND** it does NOT call the Slack API (`users.info` or `bots.info`)
- **AND** the fallback is cached like any other user info entry

#### Scenario: Active workers display for auto-respond sessions
- **WHEN** an auto-respond session is active
- **AND** the Home Tab shows active workers
- **THEN** the worker displays "Auto-Respond" as plain text instead of a `<@userId>` Slack mention

#### Scenario: Session ID parsing for synthetic user
- **WHEN** `parseSessionId()` is called for an auto-respond session with synthetic user ID
- **THEN** the regex MAY fail to extract the userId (since `"auto-respond"` does not match the `U[A-Z0-9]+` pattern)
- **AND** this is a known limitation affecting only the last-resort session restoration fallback
- **AND** the primary restoration path (loading from disk via session ID) is unaffected

### Requirement: Followed threads on the session

`SessionContext` SHALL support an optional `followedThreads` array persisted in `context.json`, each entry carrying `{ channel, threadTs, mode: "follow" | "followAndInteract", lastInjectedTs, pendingCount, addedBy }`. `addedBy` records the Slack user who added the thread (the reactor/requester at bootstrap, or the caller of `follow_thread`) and is surfaced by `list_followed_threads` and the investigation delivery context. Sessions without the field SHALL behave exactly as before (no follows, no read-time migration). Investigation rounds SHALL resume the session's Claude context via the existing `sdkSessionId` mechanism, with drained side-thread deltas injected into the turn's context.

#### Scenario: Field persisted across restarts

- **WHEN** a session with `followedThreads` entries is persisted and the process restarts
- **THEN** the loaded session carries the same entries, including each cursor position

#### Scenario: Legacy sessions unaffected

- **WHEN** a session without `followedThreads` is loaded
- **THEN** no default is materialized and no follow behavior applies

#### Scenario: Rounds compose with SDK resume

- **WHEN** an investigation round runs on a session with a stored `sdkSessionId`
- **THEN** the Claude conversation resumes from prior context
- **AND** the injected deltas appear as new turn context, not as a fresh conversation

