# user-registry Specification

## Purpose
TBD - created by archiving change centralize-plugin-user-registry. Update Purpose after archive.
## Requirements
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

### Requirement: Write-Through Population From Core Resolution

The system SHALL populate the registry through a single core user-resolution primitive, so that resolving a user anywhere in core writes that user's identity into the registry. Core code paths that need user identity SHALL read through the registry rather than an ephemeral in-memory-only cache.

#### Scenario: Core handler warms the registry

- **WHEN** a core message handler resolves a user's display name to attach to a session
- **THEN** the resolution primitive persists `{ userId, displayName, lastFetched }` into the registry
- **AND** a subsequent lookup for the same user reads the persisted record

#### Scenario: Resolution failure does not corrupt the registry

- **WHEN** a Slack identity fetch fails for a user
- **THEN** the system returns the existing cached record if one exists, or a safe fallback otherwise
- **AND** does not throw and does not overwrite the stored record with empty values

### Requirement: Invisible Lazy Display-Name Refresh

The system SHALL refresh `displayName` lazily and invisibly. A `get` for a user whose `lastFetched` is within the freshness TTL SHALL return the cached record without contacting Slack; a `get` for a missing or stale record SHALL fetch from Slack, stamp `lastFetched`, persist, and return the updated record. Listing users SHALL NOT fan out to Slack.

#### Scenario: Fresh record served from cache

- **WHEN** a caller gets a user whose `lastFetched` is within the TTL
- **THEN** the system returns the cached record
- **AND** makes no Slack API call

#### Scenario: Stale record refreshed on get

- **WHEN** a caller gets a user whose `lastFetched` is older than the TTL
- **THEN** the system fetches the current display name from Slack
- **AND** updates `displayName` and `lastFetched` and persists the record
- **AND** returns the refreshed record

#### Scenario: Stale refresh failure falls back to cached value

- **WHEN** a stale-record refresh is attempted but the Slack fetch fails
- **THEN** the system returns the previously cached record unchanged
- **AND** does not throw

#### Scenario: List does not contact Slack

- **WHEN** a caller lists users
- **THEN** the system returns the cached registry records as-is
- **AND** makes no Slack API call regardless of record staleness

#### Scenario: Concurrent stale gets coalesce into one refresh

- **WHEN** two callers `get` the same stale user concurrently
- **THEN** the system issues at most one Slack fetch for that user
- **AND** both callers receive the refreshed record

#### Scenario: Refresh skipped when Slack client unavailable

- **WHEN** a `get` finds a stale or missing record but no Slack client is connected yet
- **THEN** the system returns the cached record (or a safe fallback) without attempting a fetch
- **AND** does not throw

> The freshness TTL is a single internal constant in this version (not surfaced as configuration); it may become configurable in a later change without altering this contract.

### Requirement: SDK Users Accessor

The system SHALL expose the registry to plugins through `sdk.users` with exactly three concerns — `get`, `list`, and `data(schema)` — and SHALL hide population, persistence, freshness, and the `lastFetched` field from plugins. Plugins SHALL NOT access `data/state/users.json` directly.

#### Scenario: get returns core identity only

- **WHEN** a plugin calls `sdk.users.get(userId)`
- **THEN** the SDK returns `{ userId, displayName }` for a known user, or `null` for an unknown user
- **AND** the returned object does not include `lastFetched` or any other plugin's namespace

#### Scenario: list returns all known users

- **WHEN** a plugin calls `sdk.users.list()`
- **THEN** the SDK returns the core identity (`{ userId, displayName }`) of every record in the registry

#### Scenario: data(schema) reads the caller's own namespace

- **WHEN** a plugin calls `sdk.users.data(schema).get(userId)`
- **THEN** the SDK reads `plugins.<callerPluginName>` from the user's record
- **AND** validates it against the plugin-supplied zod schema, returning the parsed value or `null` on absence/mismatch
- **AND** never exposes another plugin's namespace

#### Scenario: data(schema) merges into the caller's own namespace

- **WHEN** a plugin calls `sdk.users.data(schema).merge(userId, partial)`
- **THEN** the SDK field-merges `partial` into `plugins.<callerPluginName>` on that user's record (omitted fields retain their prior value)
- **AND** the write is serialized through the single core writer so concurrent merges do not lose data

### Requirement: Serialized Single-Writer Persistence

The system SHALL funnel all registry writes through a single serialized core writer so that concurrent writes from core and multiple plugins do not produce lost updates. Plugins SHALL have no direct file handle to the registry.

#### Scenario: Concurrent merges from two plugins both persist

- **WHEN** two plugins call `sdk.users.data(schema).merge` for the same user concurrently
- **THEN** both plugins' namespace writes are present in the final persisted record
- **AND** neither write overwrites the other's namespace

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

