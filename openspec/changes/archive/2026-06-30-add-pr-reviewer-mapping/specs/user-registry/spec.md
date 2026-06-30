## MODIFIED Requirements

### Requirement: Persisted User Registry

The system SHALL maintain a durable user registry persisted at `data/state/users.json`, keyed by Slack `userId`, holding core identity fields plus a per-plugin namespace bag. Each record SHALL contain `userId`, `displayName`, a core-owned `lastFetched` timestamp (epoch millis of the last successful Slack resolution), an OPTIONAL core-owned `github` object (`{ username: string }`) holding the user's mapped GitHub login, and an optional `plugins` object mapping plugin name to that plugin's namespaced data. The `github` field SHALL be a first-class core identity attribute, NOT stored under the `plugins` namespace bag. The record schema SHALL remain a graceful (permissive) reader: records without a `github` field SHALL load unchanged.

#### Scenario: Record persisted on first resolution

- **WHEN** the system resolves a user's identity from Slack for the first time
- **THEN** it writes a record `{ userId, displayName, lastFetched: <now> }` into `data/state/users.json`
- **AND** the record survives a process restart

#### Scenario: Per-plugin namespace isolated under plugins key

- **WHEN** a plugin stores data for a user
- **THEN** the data is written under `plugins.<pluginName>` on that user's record
- **AND** core identity fields (`userId`, `displayName`, `lastFetched`, `github`) cannot be shadowed by a plugin namespace

#### Scenario: Graceful load on malformed file

- **WHEN** `data/state/users.json` is present but does not match the registry schema
- **THEN** the system logs a warning and treats the registry as empty rather than throwing
- **AND** does not delete or overwrite real records as a side effect of the failed read

#### Scenario: Legacy record without github field loads unchanged

- **WHEN** an existing record has no `github` field
- **THEN** it loads successfully with `github` absent
- **AND** no default GitHub identity is fabricated

#### Scenario: Malformed github field is tolerated per record

- **WHEN** a record's `github` field has the wrong shape (e.g. a bare string instead of `{ username }`)
- **THEN** the `github` sub-field is parsed tolerantly: the malformed value is logged and treated as absent
- **AND** the rest of that record (and the rest of the registry) is preserved rather than wiped

## ADDED Requirements

### Requirement: GitHub Identity Write-Through

The system SHALL provide a serialized write-through mutator that sets or clears a user's core `github` field without disturbing other core fields or plugin namespaces. Setting SHALL field-merge the new value; clearing (passing `null`) SHALL remove the `github` field. The mutation SHALL go through the registry's serialized write chain so concurrent edits do not lose updates.

#### Scenario: Set github username preserves other fields

- **WHEN** the mutator sets `github` for a user
- **THEN** the record's `github.username` is updated
- **AND** `displayName`, `lastFetched`, and any `plugins` namespaces are preserved

#### Scenario: Clearing github username removes the field

- **WHEN** the mutator clears `github` for a user
- **THEN** the `github` field is removed from the record
- **AND** the remaining core and plugin fields are preserved

#### Scenario: Concurrent writes to the same user are serialized

- **WHEN** two `github` writes for the SAME user are issued concurrently
- **THEN** both updates funnel through the serialized write chain (read-modify-write)
- **AND** the later write does not clobber the earlier one with a stale base

#### Scenario: Write for an unknown user creates a placeholder record

- **WHEN** the mutator is called for a `userId` with no existing record
- **THEN** it creates a placeholder record (empty `displayName`, `lastFetched: 0`) carrying the `github` field
- **AND** a later identity `get` refreshes the placeholder's `displayName`
