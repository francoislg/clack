## ADDED Requirements

### Requirement: Resilient per-job loading with quarantine

The cron-job loader SHALL validate each persisted job individually, never as an atomic whole-collection parse. A job that fails validation SHALL be preserved (quarantined), never discarded, and SHALL NOT be scheduled. A single invalid job SHALL NOT prevent any other job from loading. Quarantined jobs SHALL be held in a separate `quarantinedJobs` collection; scheduler-facing queries SHALL iterate only the valid `jobs` collection, so a quarantined object is structurally unreachable by the scheduler (no per-job "quarantined" flag is consulted).

#### Scenario: One invalid job does not wipe the collection

- **GIVEN** `cron-jobs.json` contains N valid jobs and 1 job that fails `cronJobZod` validation (e.g. a required field removed by a schema change)
- **WHEN** `loadJobs()` runs
- **THEN** the N valid jobs are loaded and available to the scheduler
- **AND** the 1 invalid job is placed, verbatim, into an in-memory quarantine
- **AND** the loader returns without throwing and without returning an empty collection

#### Scenario: Quarantined jobs are never scheduled

- **GIVEN** a job is quarantined
- **WHEN** the scheduler evaluates jobs to run
- **THEN** the quarantined job is not among the schedulable jobs and never fires

### Requirement: Quarantine survives the persist cycle

The persisted state SHALL carry quarantined jobs in a top-level `quarantinedJobs` array alongside `jobs`. Every `saveState` write SHALL re-serialize the `quarantinedJobs` array verbatim, so that a write triggered by unrelated activity (e.g. a plugin `reconcileCronJobs` on boot) can never overwrite a quarantined job out of existence.

#### Scenario: Quarantine round-trips through save

- **GIVEN** the loader has quarantined one job
- **WHEN** any create/update/delete triggers `saveState`
- **THEN** the written file contains both the valid `jobs` and the untouched `quarantinedJobs` array
- **AND** reloading the file yields the same valid jobs and the same quarantined entry

#### Scenario: Clean files stay clean

- **GIVEN** no job is quarantined
- **WHEN** `saveState` writes the file
- **THEN** the `quarantinedJobs` field is omitted (empty array not serialized)

### Requirement: Total-parse-failure freezes persistence instead of overwriting

When the persisted file cannot be parsed at all (`JSON.parse` throws, or the top-level shape is unusable), the loader SHALL NOT null-to-empty and allow a subsequent write to overwrite the file. It SHALL snapshot the unreadable file, freeze persistence, and report — leaving the original file intact for recovery.

#### Scenario: Corrupt file is snapshotted and preserved

- **GIVEN** `cron-jobs.json` is truncated or otherwise unparseable
- **WHEN** `loadJobs()` runs
- **THEN** the file is copied to `cron-jobs.corrupt-<timestamp>.json` (best-effort)
- **AND** an in-memory persistence-frozen flag is set — set even if the snapshot copy fails (an absent snapshot never unfreezes nor risks overwriting the original)
- **AND** the live schedulable set is empty for this process lifetime until repaired

#### Scenario: Freeze re-arms across restarts while the file stays corrupt

- **GIVEN** the process is restarted while `cron-jobs.json` is still unparseable
- **WHEN** `loadJobs()` runs on the fresh process (the in-memory flag defaults to unfrozen)
- **THEN** the same total-parse-failure path re-freezes persistence
- **AND** the original corrupt file is never overwritten across any number of restarts until it is repaired

#### Scenario: Frozen persistence does not overwrite the original

- **GIVEN** persistence is frozen after a total parse failure
- **WHEN** any code path calls `saveState`
- **THEN** the call logs an error and returns without writing
- **AND** the original (corrupt) `cron-jobs.json` on disk is left byte-for-byte intact

#### Scenario: Freeze clears on a subsequent clean load

- **GIVEN** persistence was frozen
- **WHEN** the file is repaired and a later `loadJobs()` parses successfully
- **THEN** the persistence-frozen flag is cleared and normal writes resume

### Requirement: Owner is notified of quarantine or freeze

Any quarantine of a job, or any persistence freeze, SHALL notify the workspace owner(s) via DM, best-effort, without blocking or failing the load. The notification SHALL identify each quarantined job (id, failing field path, error) or name the corrupt-snapshot file on freeze.

#### Scenario: Owner DM on quarantine

- **WHEN** one or more jobs are quarantined during a load
- **THEN** the owner(s) receive a DM listing each quarantined job's id, the failing field path, and the validation error
- **AND** a failure to deliver the DM does not affect the loaded jobs

#### Scenario: Owner DM on persistence freeze

- **WHEN** a total parse failure freezes persistence
- **THEN** the owner(s) receive a DM naming the `cron-jobs.corrupt-<timestamp>.json` snapshot and stating that scheduling is paused until repaired
