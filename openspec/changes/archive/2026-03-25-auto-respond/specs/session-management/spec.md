## ADDED Requirements

### Requirement: Synthetic User Identity for Auto-Respond

The system SHALL support sessions with a synthetic user identity for auto-respond triggers.

#### Scenario: Session created with synthetic user ID
- **WHEN** an auto-respond rule triggers
- **THEN** the session is created with `userId` set to `"auto-respond"`
- **AND** the session ID includes the synthetic user ID for uniqueness

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
- **THEN** the worker displays "Auto-Respond" as plain text instead of a `<@userId>` Slack mention (which would render as a broken reference for the synthetic ID)

#### Scenario: Session ID parsing for synthetic user
- **WHEN** `parseSessionId()` is called for an auto-respond session
- **THEN** the regex MAY fail to extract the userId (since `"auto-respond"` does not match the `U[A-Z0-9]+` pattern)
- **AND** this is a known limitation affecting only the last-resort session restoration fallback
- **AND** the primary restoration path (loading from disk via session ID) is unaffected

## MODIFIED Requirements

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
