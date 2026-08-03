# session-management Delta

## ADDED Requirements

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
