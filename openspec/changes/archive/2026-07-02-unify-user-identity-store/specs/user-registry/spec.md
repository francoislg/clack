## MODIFIED Requirements

### Requirement: Persisted User Registry

The system SHALL maintain a durable user registry persisted at `data/state/users.json`, keyed by Slack `userId`, holding core identity fields plus a per-plugin namespace bag. Each record SHALL contain `userId`, `displayName`, a core-owned `lastFetched` timestamp (epoch millis of the last successful Slack resolution), OPTIONAL Slack-sourced core fields `username` and `avatarUrl` (the member's Slack handle and profile image, backfilled by the full-roster sync), an OPTIONAL core-owned `github` object (`{ username: string }`) holding the user's mapped GitHub login, an OPTIONAL core-owned `otherNames` array of alternate name strings (human-authored aliases used for user search), and an optional `plugins` object mapping plugin name to that plugin's namespaced data. The `github`, `otherNames`, `username`, and `avatarUrl` fields SHALL be first-class core attributes, NOT stored under the `plugins` namespace bag. The record schema SHALL remain a graceful (permissive) reader: records without any of `username`, `avatarUrl`, `github`, or `otherNames` SHALL load unchanged, and a malformed value for any of these SHALL be logged and treated as absent for that field without failing the record or wiping the registry.

#### Scenario: Record persisted on first resolution

- **WHEN** the system resolves a user's identity from Slack for the first time
- **THEN** it writes a record `{ userId, displayName, lastFetched: <now> }` into `data/state/users.json`
- **AND** the record survives a process restart

#### Scenario: Per-plugin namespace isolated under plugins key

- **WHEN** a plugin stores data for a user
- **THEN** the data is written under `plugins.<pluginName>` on that user's record
- **AND** core identity fields (`userId`, `displayName`, `lastFetched`, `username`, `avatarUrl`, `github`, `otherNames`) cannot be shadowed by a plugin namespace

#### Scenario: Graceful load on malformed file

- **WHEN** `data/state/users.json` is present but does not match the registry schema
- **THEN** the system logs a warning and treats the registry as empty rather than throwing
- **AND** does not delete or overwrite real records as a side effect of the failed read

#### Scenario: Legacy record without new core fields loads unchanged

- **WHEN** an existing record has no `github`, `otherNames`, `username`, or `avatarUrl` field
- **THEN** it loads successfully with those fields absent
- **AND** no default value is fabricated for any of them

#### Scenario: Malformed core field is tolerated per record

- **WHEN** a record's `github`, `otherNames`, `username`, or `avatarUrl` field has the wrong shape (e.g. `github` as a bare string, or `otherNames` as a string instead of an array)
- **THEN** that sub-field is parsed tolerantly: the malformed value is logged and treated as absent
- **AND** the rest of that record (and the rest of the registry) is preserved rather than wiped

## ADDED Requirements

### Requirement: Other-Names Write-Through

The system SHALL provide a serialized write-through mutator that adds and/or removes entries in a user's core `otherNames` array without disturbing other core fields or plugin namespaces. The mutator SHALL normalize entries (trim surrounding whitespace, drop empty strings, and deduplicate case-insensitively) and SHALL preserve insertion order of surviving entries. Removing an entry SHALL match case-insensitively. When the resulting array is empty, the `otherNames` field SHALL be omitted from the record rather than stored as an empty array. The mutation SHALL go through the registry's serialized write chain so concurrent edits do not lose updates, and SHALL create a placeholder record for an unknown user.

#### Scenario: Add appends normalized, deduplicated names

- **WHEN** the mutator adds `["Jo", " jo ", "Jonathan"]` to a record with no `otherNames`
- **THEN** the record's `otherNames` becomes `["Jo", "Jonathan"]` (trimmed, case-insensitively deduped)
- **AND** other core fields and plugin namespaces are preserved

#### Scenario: Remove deletes case-insensitively

- **WHEN** the mutator removes `["jonathan"]` from a record whose `otherNames` is `["Jo", "Jonathan"]`
- **THEN** the record's `otherNames` becomes `["Jo"]`

#### Scenario: Emptying otherNames omits the field

- **WHEN** the mutator removes the last remaining entry from `otherNames`
- **THEN** the `otherNames` field is omitted from the record
- **AND** the remaining core and plugin fields are preserved

#### Scenario: Concurrent otherNames writes are serialized

- **WHEN** two `otherNames` writes for the SAME user are issued concurrently
- **THEN** both updates funnel through the serialized write chain (read-modify-write)
- **AND** the later write does not clobber the earlier one with a stale base

#### Scenario: Write for an unknown user creates a placeholder record

- **WHEN** the mutator is called for a `userId` with no existing record
- **THEN** it creates a placeholder record (`displayName: ""`, `lastFetched: 0`) carrying the `otherNames` field
- **AND** a later identity resolution refreshes the placeholder's `displayName`
