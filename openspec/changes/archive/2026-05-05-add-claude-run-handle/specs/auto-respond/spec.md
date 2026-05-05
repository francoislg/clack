## MODIFIED Requirements

### Requirement: Thread Auto-Respond

The system SHALL support automatic responses to thread replies in threads with existing Clack sessions, gated by tracking state and pre-analysis to avoid responding to noise. When a Claude run is already active for the same thread (per the `active-runs-registry` capability), incoming messages SHALL be delivered to that run via `handle.sendUpdate(text)` instead of being dropped or spawned as a parallel run.

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

## REMOVED Requirements

### Requirement: Thread processing lock scenario

**Reason:** The `processingThreads` Set in `auto-respond` is replaced by the active-runs registry. Where the lock previously caused fast-arriving thread replies to be silently dropped, the new behavior delivers them to the active run via `handle.sendUpdate(text)`. Drops only occur if `sendUpdate` rejects (the run already settled), in which case the handler falls through to spawning a fresh run.

**Migration:** Code that reads or modifies `processingThreads` is removed. Detection of "is a run active for this thread?" goes through the active-runs registry. There is no policy of "drop if already processing" — the policy is "deliver if alive, spawn if not."
