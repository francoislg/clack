## MODIFIED Requirements

### Requirement: Session State Persistence
The `isEphemeral` field is removed from session context. Delivery mode is derived from `triggerType` and `dmChannel` presence.

#### Scenario: Context file structure (UPDATED)
- **WHEN** a session is created or updated
- **THEN** the context does NOT include `isEphemeral`
- **AND** delivery mode is derived from `triggerType` and whether `dmChannel` is set

### Requirement: Session State Persistence — Continuation State
The `refine` action type is removed from continuation records.

#### Scenario: Continuation state persisted (UPDATED)
- **WHEN** a user interacts with a continuation action (choice, followup)
- **THEN** the session records: the action type (`"choice"` or `"followup"`), the user's input, and timestamp
- **AND** `"refine"` is no longer a valid action type (thread-based replies replace it)

### Requirement: Session Identification (UPDATED)
Sessions are no longer identified via ephemeral message interactions.

#### Scenario: Same message, same user continues session (UPDATED)
- **WHEN** a user interacts with buttons on a streamed response
- **THEN** the system looks up the existing session for that message and user

### Requirement: Session Restoration (UPDATED)
Session restoration no longer involves ephemeral-specific handling.

#### Scenario: Lazy session restoration (UPDATED)
- **WHEN** a user clicks a button (choice, followup, change action) after an app restart
- **AND** the session is not in memory
- **THEN** the system loads the session from disk and restores session info
- **AND** the restored `SessionInfo` does NOT include `isEphemeral`

### Requirement: Expired Session Recreation (UPDATED)
Expired session scenarios no longer reference ephemeral messages.

#### Scenario: Accept with expired session
**Removed** — Accept action no longer exists.

#### Scenario: Refine or Update with expired session
**Removed** — Refine action no longer exists. Update is now a change thread follow-up, not a session recreation scenario.
