## ADDED Requirements

### Requirement: Daily state backup

The system SHALL, once per day at local midnight, copy each configured state folder into a dated backup directory under `data/backups/`. The backup SHALL recursively copy regular files and directories only (special files — sockets, FIFOs, devices — are skipped, and symbolic links are NOT followed), SHALL be a faithful copy of the source file content, and SHALL NOT modify the live state.

#### Scenario: Midnight backup produces a dated snapshot

- **GIVEN** the backup feature is enabled with `folders: ["state"]`
- **WHEN** local midnight (in the configured timezone) arrives
- **THEN** the files under `data/state/` are copied to `data/backups/<YYYY-MM-DD>/state/`
- **AND** the copies have identical content (byte-for-byte) to the source files
- **AND** the live `data/state/` files are unchanged

#### Scenario: Symlinks and special files are not copied

- **GIVEN** a configured source folder containing a symbolic link and/or a special file (socket, FIFO)
- **WHEN** a backup runs
- **THEN** the symlink is not followed and neither the link nor its target is copied
- **AND** special files are skipped
- **AND** the remaining regular files are backed up normally

#### Scenario: Backup fires once per day, including across a DST transition

- **GIVEN** the scheduler recomputes the next local-midnight instant after each fire
- **WHEN** a DST transition occurs (spring-forward or fall-back) on a given day
- **THEN** the backup fires exactly once at local midnight (00:00) for that day, with no missed or duplicate fire

### Requirement: Configurable, extensible folder set

The set of backed-up folders SHALL be configuration-driven (`backup.folders`, paths relative to `data/`), defaulting to `["state"]`. The copy mechanism SHALL iterate the configured list so additional folders can be backed up in future by configuration alone, with no code change.

#### Scenario: Default folder set

- **GIVEN** no `backup.folders` is configured
- **WHEN** a backup runs
- **THEN** only `data/state/` is backed up

#### Scenario: Additional folders via config

- **GIVEN** `backup.folders: ["state", "configuration"]`
- **WHEN** a backup runs
- **THEN** both `data/state/` and `data/configuration/` are reproduced under `data/backups/<date>/`

#### Scenario: A configured folder that does not exist is skipped

- **GIVEN** `backup.folders: ["state", "missing"]` and `data/missing/` does not exist
- **WHEN** a backup runs
- **THEN** `data/backups/<date>/state/` is created successfully
- **AND** the absent `missing` folder is skipped with a logged warning
- **AND** the run completes without error (no `data/backups/<date>/missing/` is created)

### Requirement: Config is validated fail-fast at boot

The `backup` config block SHALL be validated at boot (fail-fast), consistent with other boot config. An invalid timezone or an unsafe folder entry SHALL fail startup with a clear error rather than degrade silently.

#### Scenario: Invalid timezone fails boot

- **GIVEN** `backup.timezone: "Not/AZone"`
- **WHEN** the process loads config at boot
- **THEN** config validation throws a clear error naming the invalid timezone
- **AND** the process does not silently fall back to UTC

#### Scenario: Unsafe folder entry fails boot

- **GIVEN** `backup.folders` contains `""`, `"."`, an absolute path, or a path resolving to `data/backups` or an ancestor of it
- **WHEN** the process loads config at boot
- **THEN** config validation throws a clear error identifying the unsafe entry
- **AND** no backup source can recurse into the backup tree

### Requirement: Backup failures are isolated

A backup run SHALL be best-effort: any I/O error during a run (disk full, unwritable mount, a file removed mid-copy) SHALL be caught and logged, SHALL NOT crash boot or the scheduler, and SHALL NOT promote a partial copy to a complete dated backup.

#### Scenario: A copy error does not produce a false-complete backup

- **GIVEN** a backup run encounters a write error partway through (e.g. disk full)
- **WHEN** the error occurs
- **THEN** the error is logged
- **AND** the `.partial` staging dir is NOT renamed to `data/backups/<date>/` (no false-complete backup)
- **AND** the scheduler remains armed and the process continues running
- **AND** the next scheduled run attempts a fresh backup

### Requirement: Backups are additive and never delete

A backup run SHALL never delete or overwrite live state, and SHALL never prune prior backups. Old dated backups accumulate until an operator removes them manually.

#### Scenario: Prior backups are preserved

- **GIVEN** `data/backups/<yesterday>/` exists
- **WHEN** today's backup runs
- **THEN** `data/backups/<yesterday>/` remains intact
- **AND** `data/backups/<today>/` is created alongside it
- **AND** no automatic process deletes either

### Requirement: Atomic backup directory

A backup run SHALL stage its copy in a partial directory and finalize by rename, so an interrupted run never leaves a partially-written dated directory that appears complete.

#### Scenario: Interrupted run leaves no false-complete backup

- **GIVEN** a backup run is interrupted mid-copy
- **WHEN** the process next inspects `data/backups/`
- **THEN** no complete `data/backups/<date>/` exists for the interrupted run (only an ignored `.partial` staging dir may remain)
- **AND** the next successful run produces a complete `data/backups/<date>/`

#### Scenario: A stale `.partial` from a prior crash is replaced, not merged

- **GIVEN** a `data/backups/.<today>.partial/` dir remains from an earlier crashed run
- **WHEN** a new backup runs for the same day
- **THEN** the stale `.partial` dir is removed before staging begins
- **AND** the resulting `data/backups/<today>/` is a fresh complete copy, never a merge of the stale and new contents

#### Scenario: Same-day re-run replaces atomically

- **GIVEN** `data/backups/<today>/` already exists
- **WHEN** a backup runs again for the same day
- **THEN** it is replaced by a fresh complete snapshot via staged-then-rename, never left half-updated

### Requirement: Boot catch-up for a missed midnight

On startup, if the feature is enabled and today's backup directory does not yet exist, the system SHALL run one backup immediately, so downtime or a deploy spanning midnight does not skip that day.

#### Scenario: Missed midnight is caught up on boot

- **GIVEN** the process was down at midnight and `data/backups/<today>/` is absent
- **WHEN** the process boots
- **THEN** exactly one backup runs shortly after startup
- **AND** the normal next-midnight schedule is armed thereafter

#### Scenario: No redundant catch-up

- **GIVEN** `data/backups/<today>/` already exists at boot
- **WHEN** the process boots
- **THEN** no catch-up backup runs

#### Scenario: Catch-up and scheduled fire never run concurrently

- **GIVEN** a boot catch-up backup is still running when a scheduled midnight fire would occur (or vice versa)
- **WHEN** the second run would start
- **THEN** a single-run-in-flight guard causes it to be skipped rather than run concurrently
- **AND** at most one complete `data/backups/<date>/` snapshot results for that day

### Requirement: Permission-safe under the non-root container

Backups SHALL be written by the running process using its own identity, with no ownership changes, and SHALL NOT widen the permissions of the data they copy. This keeps the feature correct under the production container, which runs as a non-root user on the mounted data disk.

#### Scenario: No ownership change is attempted

- **GIVEN** the process runs as a non-root user (as in the production container)
- **WHEN** a backup writes files and directories
- **THEN** no `chown` is attempted and the write succeeds using the process's own identity
- **AND** the backup files carry the same ownership as the live state on the same mount

#### Scenario: Copied files keep their source permissions

- **GIVEN** a source state file with mode `600` and its state directory with mode `700`
- **WHEN** the file is backed up
- **THEN** the backup directory is created with mode `0o700`
- **AND** the copied file is set to its source mode (`600`), not a wider default
- **AND** the backup never grants broader access than the original

### Requirement: Feature gate

The backup feature SHALL be gated by `backup.enabled` (default enabled). When disabled, no scheduler is armed and no backup files are written.

#### Scenario: Disabled feature is fully inert

- **GIVEN** `backup.enabled: false`
- **WHEN** the process boots and midnight passes
- **THEN** no backup scheduler is armed and nothing is written under `data/backups/`
