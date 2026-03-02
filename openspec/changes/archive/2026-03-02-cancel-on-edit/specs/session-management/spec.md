## MODIFIED Requirements

### Requirement: Session State Persistence

The system SHALL persist session state to the filesystem, including structured tool interaction data and DM delivery coordinates. Thread conversation history (questions, answers, refinements) is derived from Slack on each request and is NOT persisted. Aborted sessions SHALL retain their state for reuse on restart.

#### Scenario: Context file structure

- **WHEN** a session is created or updated
- **THEN** the system writes `data/sessions/{session-id}/context.json`
- **AND** includes: sessionId, channelId, messageTs, threadTs, userId, username, displayName, errors, createdAt, lastActivity
- **AND** includes `username` and `displayName` for the requesting user when `fetchUserNames` is enabled
- **AND** does NOT persist `refinements`, `lastAnswer`, or `threadContext` (these are fetched from Slack on each request)

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

- **WHEN** a user interacts with a continuation action (choice, followup, refine)
- **THEN** the session records: the action type, the user's input (choice value, followup prompt, or refinement text), and timestamp
- **AND** the continuation history is available for context reconstruction in subsequent queries

#### Scenario: DM delivery coordinates persisted

- **WHEN** a session is created with DM-first delivery
- **THEN** the session stores `dmChannel` (DM channel ID) and `dmThreadTs` (DM root message timestamp)
- **AND** the session stores `originChannel` and `originThreadTs` for the original channel message
- **AND** these coordinates are persisted in `context.json`
- **AND** are available for session restoration after app restart
