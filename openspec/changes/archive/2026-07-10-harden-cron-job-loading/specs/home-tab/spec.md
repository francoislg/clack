## ADDED Requirements

### Requirement: Quarantined schedules recovery panel

The Home Tab SHALL present a "Quarantined schedules" section, visible to owner/admin only, when one or more cron jobs are quarantined. Each entry SHALL show a human-readable summary and offer Retry and Delete actions. Both Retry and Delete SHALL be owner/admin-gated (the same gate as the existing worker-quarantine controls); non-admin viewers SHALL see no section at all. Deletion SHALL be the only path that removes a quarantined job, and it SHALL require an explicit owner/admin action — no automatic pruning.

#### Scenario: Panel appears only when there is something to recover

- **GIVEN** no cron job is quarantined
- **WHEN** an owner/admin opens the Home Tab
- **THEN** no "Quarantined schedules" section is rendered
- **AND** when at least one job is quarantined, the section is rendered listing each entry with its id/name (when present in the raw object, else a positional index), failing field, and error

#### Scenario: Section is hidden from non-admins

- **GIVEN** one or more cron jobs are quarantined
- **WHEN** a non-admin (member/dev) opens the Home Tab
- **THEN** no "Quarantined schedules" section and no Retry/Delete controls are rendered for them

#### Scenario: Retry re-validates and restores

- **GIVEN** a quarantined job whose raw object has been repaired (or a schema loosened)
- **WHEN** the owner clicks Retry
- **THEN** the stored raw object is re-validated
- **AND** on success it moves from `quarantinedJobs` into the live `jobs` and is persisted and schedulable
- **AND** on failure it remains quarantined and the current error is surfaced

#### Scenario: Delete is explicit and owner/admin-gated

- **GIVEN** a quarantined job the owner/admin has decided to discard
- **WHEN** an owner/admin clicks Delete
- **THEN** the entry is removed from `quarantinedJobs` and the state persisted
- **AND** no non-admin and no automatic process can remove a quarantined job

### Requirement: Frozen-persistence banner

When cron-job persistence is frozen after a total parse failure, the Home Tab SHALL surface a banner to owner/admin indicating that scheduling is paused until `cron-jobs.json` is repaired, so the freeze is never silent beyond the owner DM.

#### Scenario: Banner shown while frozen

- **GIVEN** cron-job persistence is frozen (a total parse failure occurred this process lifetime)
- **WHEN** an owner/admin opens the Home Tab
- **THEN** a banner states that scheduling is paused until `cron-jobs.json` is repaired
- **AND** when persistence is not frozen, no such banner is rendered
