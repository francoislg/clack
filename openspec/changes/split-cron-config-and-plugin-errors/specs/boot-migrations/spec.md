## ADDED Requirements

### Requirement: Boot Migration Rewrites Legacy Cron Config Fields

The system SHALL include a one-shot blocking boot migration that rewrites legacy cron-related top-level fields in `data/config.json` into the new `cron` namespace. Specifically:

- A top-level `allowScheduledMessages: boolean` field SHALL be moved to `cron.userSchedules: boolean`. The legacy field SHALL be removed after the rewrite.
- A top-level `scheduledMessagesMaxRunHistory: number` field SHALL be moved to `cron.maxRunHistory: number`. The legacy field SHALL be removed after the rewrite.

If the new `cron` namespace already contains a value for a target field, the migration SHALL prefer the new value and SHALL only delete the legacy field (no overwrite). If neither the legacy field nor the new field is present, the migration SHALL leave the config file unchanged for that key (no defaults are written; the absence drives the default-value handling at runtime).

The migration SHALL be guarded by the existing `data/state/migration-version.json` mechanism and run exactly once per deployment. The migration SHALL log a single info-level message naming both old and new keys.

#### Scenario: Legacy allowScheduledMessages: true is migrated

- **GIVEN** `data/config.json` contains top-level `"allowScheduledMessages": true` and no `cron` block
- **WHEN** the boot migration runs
- **THEN** `data/config.json` is rewritten with `cron: { userSchedules: true }`
- **AND** the top-level `allowScheduledMessages` field is removed
- **AND** the migration version is incremented

#### Scenario: Legacy allowScheduledMessages: false is migrated

- **GIVEN** `data/config.json` contains top-level `"allowScheduledMessages": false` and no `cron` block
- **WHEN** the boot migration runs
- **THEN** `data/config.json` is rewritten with `cron: { userSchedules: false }`
- **AND** the top-level `allowScheduledMessages` field is removed

#### Scenario: Legacy scheduledMessagesMaxRunHistory is migrated

- **GIVEN** `data/config.json` contains top-level `"scheduledMessagesMaxRunHistory": 50`
- **WHEN** the boot migration runs
- **THEN** the resulting `cron` block contains `maxRunHistory: 50`
- **AND** the top-level `scheduledMessagesMaxRunHistory` field is removed

#### Scenario: Both legacy fields migrated together

- **GIVEN** `data/config.json` contains both `"allowScheduledMessages": true` and `"scheduledMessagesMaxRunHistory": 100`
- **WHEN** the boot migration runs
- **THEN** the resulting `cron` block contains both `userSchedules: true` AND `maxRunHistory: 100`
- **AND** both top-level legacy fields are removed

#### Scenario: New value present wins over legacy value

- **GIVEN** `data/config.json` contains both `"allowScheduledMessages": false` and `"cron": { "userSchedules": true }`
- **WHEN** the boot migration runs
- **THEN** the resulting `cron.userSchedules` remains `true` (new value preserved)
- **AND** the top-level `allowScheduledMessages` field is removed

#### Scenario: No legacy or new fields present

- **GIVEN** `data/config.json` contains neither legacy field nor a `cron` block
- **WHEN** the boot migration runs
- **THEN** the file is unchanged with respect to these keys
- **AND** the migration version is still incremented (the migration ran, just no-op)

#### Scenario: Migration runs only once

- **GIVEN** the migration has already run (the migration-version sentinel is set)
- **WHEN** the application boots again
- **THEN** the migration SHALL NOT re-run
- **AND** the config file is unchanged by this migration
