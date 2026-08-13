# requester-identity Delta

## ADDED Requirements

### Requirement: Per-Turn Identity in Query Tool Context

The query tool context's `userId` SHALL resolve to the current turn's speaker when one exists, falling back to the session creator only when the turn has no requester (e.g. the `scheduled` trigger). Every query tool that reads the context `userId` as "the user acting now" — attribution (`start_investigation` requester, `follow_thread` `addedBy`, reminder and scheduled-message attribution), ownership stamps (`createdBy`, skill ownership), and caller-scoped privacy checks (`find_session_transcript`, `stop_tracking`, `find_recent_interactions`) — SHALL therefore observe the current speaker on reused multi-user threads.

#### Scenario: Tool attribution names the current speaker on a reused thread

- **WHEN** a session created by user A is reused for a turn whose current speaker is user B and Claude calls a tool that attributes the acting user (e.g. `start_investigation`)
- **THEN** the tool observes user B as the context `userId`
- **AND** the resulting attribution names user B, not user A

#### Scenario: Scheduled trigger falls back to the session creator

- **WHEN** a tool reads the context `userId` during a `scheduled` trigger (no per-turn requester)
- **THEN** the context `userId` is the session's `userId`, unchanged from prior behavior

#### Scenario: Ownership and privacy checks evaluate the current speaker

- **WHEN** user B, on a thread whose session was created by user A, calls a caller-scoped tool such as `find_session_transcript`
- **THEN** the privacy check evaluates user B as the caller
