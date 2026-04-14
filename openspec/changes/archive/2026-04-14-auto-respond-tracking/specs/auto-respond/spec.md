## MODIFIED Requirements

### Requirement: Thread Auto-Respond

The system SHALL support automatic responses to thread replies in threads with existing Clack sessions, gated by tracking state and pre-analysis to avoid responding to noise.

#### Scenario: Thread reply in a session thread

- **WHEN** a non-bot message arrives in a thread
- **AND** `threadAutoRespond` is not `false` in config
- **AND** a Clack session exists for that thread
- **AND** the session has `autoResponseActive` equal to `true` (or the field is absent, defaulting to `true`)
- **THEN** the system runs pre-analysis (see auto-respond-pre-analysis spec) to determine whether to respond
- **AND** if pre-analysis returns `"respond"`, calls `processMessage()` with `triggerType` set to `"threadReply"`
- **AND** if pre-analysis returns `"stop"`, sets `autoResponseActive = false` on the session and does NOT call `processMessage()`

#### Scenario: Thread reply in a disengaged session

- **WHEN** a non-bot message arrives in a thread
- **AND** a Clack session exists with `autoResponseActive === false`
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

#### Scenario: Thread processing lock

- **WHEN** a thread reply triggers auto-respond
- **AND** the system is already processing a response for the same thread
- **THEN** the new message is dropped (not queued)
- **AND** only one response is processed at a time per thread
