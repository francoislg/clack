## MODIFIED Requirements

### Requirement: Session State Persistence

The system SHALL persist session state to the filesystem for Claude Code access, including structured tool interaction data.

#### Scenario: Context file structure

- **WHEN** a session is created or updated
- **THEN** the system writes `data/sessions/{session-id}/context.json`
- **AND** includes the original question, thread context, refinements, conversation history, and threadTs
- **AND** includes `username` and `displayName` for the requesting user when `fetchUserNames` is enabled

#### Scenario: Tool call history persisted

- **WHEN** Claude makes clack tool calls during a query
- **THEN** each tool call is recorded as `{ tool: string, args: object, result: object, timestamp: number }`
- **AND** the tool call history is stored in the session context
- **AND** includes all clack tool calls (query tools, action tools, submit_response)

#### Scenario: Structured last response persisted

- **WHEN** Claude calls `submit_response`
- **THEN** the full payload (sections array and actions array) is stored as `lastResponse` in the session
- **AND** replaces the flat `lastAnswer` string for new sessions
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

### Requirement: Expired Session Recreation

The system SHALL recreate expired sessions from Slack context when possible.

#### Scenario: Accept with expired session

- **WHEN** a user clicks Accept on an expired session
- **THEN** the system extracts the response from the ephemeral message blocks
- **AND** posts the response publicly without requiring session data

#### Scenario: Refine or Update with expired session

- **WHEN** a user clicks Refine or Update on an expired session
- **THEN** the system fetches the original message from Slack using the parsed messageTs
- **AND** fetches the current thread context
- **AND** creates a new session with the fetched data
- **AND** continues with the Refine or Update flow normally

#### Scenario: Choice or followup with expired session

- **WHEN** a user clicks a choice or followup button on an expired session
- **THEN** the system fetches the original message and thread context from Slack
- **AND** creates a new session with the fetched data
- **AND** injects the choice value or followup prompt into the new query
