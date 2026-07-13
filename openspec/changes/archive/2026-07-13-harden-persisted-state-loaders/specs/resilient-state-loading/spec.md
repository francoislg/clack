## ADDED Requirements

Scope: collection loaders (arrays and keyed records). Single-object state files get the freeze-only
fail-safe in the last requirement below; per-element quarantine does not apply to them.

### Requirement: Shared per-element resilient collection loader

Persisted-state collections (arrays of entries or keyed records of entries) SHALL be loaded through
a single shared loader that validates each entry individually. A valid entry SHALL load; an entry
that fails validation SHALL be quarantined (preserved verbatim), never discarded and never returned
to consumers. A single invalid entry SHALL NOT prevent any other entry from loading, and SHALL NOT
cause the collection to be returned empty.

#### Scenario: One invalid entry does not wipe an array collection

- **GIVEN** a state file holds N valid entries and 1 entry that fails its element schema
- **WHEN** the shared loader reads it as an array collection
- **THEN** the N valid entries are returned to the consumer
- **AND** the 1 invalid entry is quarantined verbatim
- **AND** the loader returns without throwing and without an empty collection

#### Scenario: One invalid entry does not wipe a record collection

- **GIVEN** a keyed-record state file where one key's value fails its element schema
- **WHEN** the shared loader reads it as a record collection
- **THEN** every other key's value is returned to the consumer
- **AND** the failing entry is quarantined under its original key
- **AND** no valid entry is lost

### Requirement: Quarantine survives the persist cycle

Quarantined entries SHALL be re-serialized on every save so that an unrelated write can never
overwrite a quarantined entry out of existence. Array files SHALL carry a `quarantined` array
alongside their collection key; record files SHALL be written as `{ entries, quarantined }`. The
`quarantined` container SHALL be omitted when empty.

#### Scenario: Quarantine round-trips through a save

- **GIVEN** the loader has quarantined an entry
- **WHEN** any create/update/delete triggers a save
- **THEN** the written file contains both the valid collection and the quarantined entry
- **AND** reloading yields the same valid entries and the same quarantined entry

#### Scenario: Legacy on-disk shape is read and migrated

- **GIVEN** a record file written in the legacy bare-record shape (no `entries` key)
- **WHEN** the loader reads it
- **THEN** the whole object is treated as the entries map
- **AND** the next write that persists state (any create/update/delete) lazily rewrites it in the
  `{ entries, quarantined }` shape without data loss — a file never written during a session is left
  untouched

#### Scenario: Legacy array quarantine field is read and normalized

- **GIVEN** an array file that carries a legacy per-store quarantine key (e.g. cron's `quarantinedJobs`)
- **WHEN** the loader reads it
- **THEN** both the valid collection and the legacy-named quarantine load correctly
- **AND** the next save rewrites the quarantine under the uniform `quarantined` key

### Requirement: Total parse failure freezes persistence instead of overwriting

The loader SHALL NOT null-to-empty a state file it cannot parse at all (`JSON.parse` throws or the
top-level shape is unusable) and allow a subsequent write to overwrite it. It SHALL instead snapshot
the unreadable file, freeze persistence for that file, and report. The freeze SHALL be keyed per file
and SHALL re-arm on a later load while the file stays corrupt, so the original SHALL never be
overwritten across restarts.

#### Scenario: Corrupt file is snapshotted and preserved

- **GIVEN** a state file is truncated, otherwise unparseable, or its top level is not the expected
  object/array shape (`null`, a string, a number, or an object missing the collection key)
- **WHEN** the loader reads it
- **THEN** the file is copied to `<name>.corrupt-<timestamp>.json` (best-effort)
- **AND** persistence for that file is frozen — set even if the snapshot copy fails
- **AND** a subsequent save for that file logs and returns without writing, leaving the original intact

#### Scenario: Freeze clears on a repaired file

- **GIVEN** a file's persistence was frozen
- **WHEN** the file is repaired and a later load parses successfully
- **THEN** the freeze for that file clears and normal writes resume

### Requirement: Owner is notified of any quarantine or freeze, labeled by source

Any quarantine or persistence freeze SHALL notify the workspace owner(s) via DM, best-effort, without
blocking or failing the load. The notification SHALL name the source store (e.g. "auto-respond
rules", "memory") and identify each quarantined entry (its key/id, failing field, error) or the
corrupt-snapshot file on freeze.

#### Scenario: Owner DM names the store and the entries

- **WHEN** one or more entries are quarantined during a load
- **THEN** the owner(s) receive a DM naming the source store and listing each quarantined entry's
  key/id, failing field, and error
- **AND** a failure to deliver the DM does not affect the loaded entries

### Requirement: Unified Home Tab quarantined-state recovery

The Home Tab SHALL present a single admin-only "Quarantined state" panel spanning all resilient
stores when any entry is quarantined, plus a persistence-freeze banner listing all frozen stores.
Each entry SHALL show its source store and offer Retry (re-validate → rejoin the live set) and Delete
(the only removal path). Retry and Delete SHALL be owner/admin-gated; no non-admin and no automatic
process SHALL remove a quarantined entry.

#### Scenario: Panel spans stores and routes actions correctly

- **GIVEN** entries are quarantined in more than one store
- **WHEN** an admin opens the Home Tab
- **THEN** the "Quarantined state" panel lists each entry under its source store label
- **AND** clicking Retry or Delete on a row routes to the correct store and re-validates or removes
  that specific entry
- **AND** a non-admin sees no such panel

#### Scenario: Retry of a still-invalid entry keeps it quarantined

- **GIVEN** a quarantined entry whose stored raw value still fails validation
- **WHEN** an admin clicks Retry
- **THEN** the entry remains quarantined and its current validation error is surfaced
- **AND** the live collection is unchanged

#### Scenario: A frozen store shows only the banner

- **GIVEN** a store whose persistence is frozen (a freeze yields an empty live set and no quarantine)
- **WHEN** an admin opens the Home Tab
- **THEN** the freeze banner names that store
- **AND** no Retry/Delete rows are shown for it (so every actionable row belongs to a non-frozen store
  and its action persists)

### Requirement: Single-object state files freeze instead of null-to-empty

A single-object state file (not a collection — e.g. `roles.json`) SHALL NOT be null-to-emptied on a
total parse/shape failure and then overwritten by a later write. It SHALL instead snapshot the file,
freeze persistence for it, DM the owner, and return the last-known-good in-memory value if present
(otherwise a default that is NOT written while frozen). No quarantine bucket and no Home Tab rows
apply — only the freeze fail-safe.

#### Scenario: A corrupt roles file is not silently blanked

- **GIVEN** `roles.json` is corrupt or has an unusable shape
- **WHEN** the loader reads it
- **THEN** persistence for the file is frozen and the owner is DMed naming the snapshot
- **AND** a subsequent save does not overwrite the original file
- **AND** the process does not persist an empty role set over the real one
