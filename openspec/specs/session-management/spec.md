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

### Requirement: Session State Persistence

The system SHALL persist session state to the filesystem, including structured tool interaction data and DM delivery coordinates. Thread conversation history (questions, answers, refinements) is derived from Slack on each request and is NOT persisted. Aborted sessions SHALL retain their state for reuse on restart.

#### Scenario: Context file structure

- **WHEN** a session is created or updated
- **THEN** the system writes `data/sessions/{session-id}/context.json`
- **AND** includes: sessionId, channelId, messageTs, threadTs, userId, username, displayName, errors, createdAt, lastActivity
- **AND** includes `username` and `displayName` for the requesting user when `fetchUserNames` is enabled
- **AND** does NOT persist `refinements`, `lastAnswer`, or `threadContext` (these are fetched from Slack on each request)
- **AND** the context does NOT include `isEphemeral`
- **AND** delivery mode is derived from `triggerType` and whether `dmChannel` is set

#### Scenario: Session reused after abort
- **WHEN** a Claude invocation is aborted due to a message edit
- **AND** processing is restarted with updated text
- **THEN** `processMessage()` finds the existing session via `findSessionByThread()`
- **AND** updates the session's `originalQuestion` with the new text
- **AND** does NOT create a duplicate session

#### Scenario: Tool call history persisted

- **WHEN** Claude makes clack tool calls during a query
- **THEN** each tool call is recorded as `{ tool: string, args: object, result: object, timestamp: number }`
- **AND** the tool call history is stored in the session context

#### Scenario: Structured last response persisted

- **WHEN** Claude calls `submit_response`
- **THEN** the full payload (sections array and actions array) is stored as `lastResponse` in the session
- **AND** the structured response can be re-rendered by the Slack block builder

#### Scenario: Staged intents persisted

- **WHEN** a query completes with staged intents referenced in `submit_response`
- **THEN** the staged intents are serialized into the session context
- **AND** button handlers can resolve refs from the persisted data
- **AND** this survives bot restarts between Claude responding and user clicking a button

#### Scenario: Continuation state persisted

- **WHEN** a user interacts with a continuation action (choice, followup)
- **THEN** the session records: the action type (`"choice"` or `"followup"`), the user's input, and timestamp
- **AND** `"refine"` is no longer a valid action type (thread-based replies replace it)
- **AND** the continuation history is available for context reconstruction in subsequent queries

#### Scenario: DM delivery coordinates persisted

- **WHEN** a session is created with DM-first delivery
- **THEN** the session stores `dmChannel` (DM channel ID) and `dmThreadTs` (DM root message timestamp)
- **AND** the session stores `originChannel` and `originThreadTs` for the original channel message
- **AND** these coordinates are persisted in `context.json`
- **AND** are available for session restoration after app restart

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
The system SHALL store thread messages with optional user identity fields.

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

#### Scenario: Thread message without user names
- **WHEN** `fetchUserNames` is disabled
- **THEN** `ThreadMessage` does not include `username` or `displayName` fields
- **AND** existing behavior is preserved

### Requirement: Channel Post Tracking
The system SHALL track the message timestamp of answers posted to the original channel thread.

#### Scenario: Channel post timestamp stored
- **WHEN** a synthesized answer is accepted and posted to the original channel thread
- **THEN** the session stores the channel message timestamp as `channelPostTs`
- **AND** this enables future "Update original post" actions via `chat.update`

#### Scenario: Channel post timestamp updated on re-post
- **WHEN** a user posts a new reply to the channel after a post-accept refinement
- **THEN** the session updates `channelPostTs` to the new message timestamp
