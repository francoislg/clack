## MODIFIED Requirements

### Requirement: Session State Persistence

The system SHALL persist session state to the filesystem, including structured tool interaction data, DM delivery coordinates, and the SDK session ID for conversation resumption. Thread conversation history (questions, answers, refinements) is derived from Slack on each request and is NOT persisted. Aborted sessions SHALL retain their state for reuse on restart.

#### Scenario: Context file structure

- **WHEN** a session is created or updated
- **THEN** the system writes `data/sessions/{session-id}/context.json`
- **AND** includes: sessionId, channelId, messageTs, threadTs, userId, username, displayName, errors, createdAt, lastActivity
- **AND** includes `username` and `displayName` for the requesting user when `fetchUserNames` is enabled
- **AND** includes `sdkSessionId` when an SDK session has been established for this session
- **AND** does NOT persist `refinements`, `lastAnswer`, or `threadContext` (these are fetched from Slack on each request)
- **AND** the context does NOT include `isEphemeral`
- **AND** delivery mode is derived from `triggerType` and whether `dmChannel` is set
- **AND** the `triggerType` field accepts `"directMessages"`, `"mentions"`, `"reactions"`, or `"autoRespond"`

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

#### Scenario: SDK session ID persisted

- **WHEN** a `clackSession()` call completes and yields a `session_id` from the SDK init message
- **THEN** the system stores the SDK session ID as `sdkSessionId` in the Clack session context
- **AND** persists it to `context.json`
- **AND** uses it as the `resumeSessionId` for subsequent queries in the same thread

#### Scenario: SDK session ID cleared on resume failure

- **WHEN** a resumed SDK session fails (file missing or corrupted)
- **AND** the wrapper falls back to a fresh session
- **THEN** the `sdkSessionId` on the Clack session is updated to the new SDK session ID
- **AND** the new ID is persisted to `context.json`

## ADDED Requirements

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
