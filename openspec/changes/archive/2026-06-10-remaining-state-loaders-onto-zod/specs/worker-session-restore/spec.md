## ADDED Requirements

### Requirement: Change-session state load is schema-driven

`parseSessionState` SHALL validate persisted change-session state against a `PersistedSessionState` zod schema rather than the hand-rolled `isValidSessionState` three-field guard, preserving its graceful contract: a parse error or shape mismatch SHALL return `null` (the session is treated as unresumable) and log at debug, never throw.

#### Scenario: Corrupt change-session state is unresumable, not fatal

- **WHEN** a persisted change-session file is not valid JSON or is missing required fields
- **THEN** `parseSessionState` returns `null` exactly as today, and restore skips that session

#### Scenario: A valid persisted change session round-trips

- **WHEN** a change-session file written by a prior build is read
- **THEN** the parsed `PersistedSessionState` matches the pre-migration result
