## ADDED Requirements

### Requirement: Reconcile Is Gated By Plugin Self-Check, Not By Config Field

Plugins that call `sdk.reconcileCronJobs(...)` SHALL be responsible for refusing to do so when `sdk.capabilities.crons` is `false`. The `reconcileCronJobs` method itself SHALL NOT silently no-op or throw based on the `config.cron.enabled` value; if a plugin chooses to call it while crons are disabled, the persistence happens as normal and the jobs simply do not tick (the scheduler is not running). The recommended pattern is for the plugin to check `sdk.capabilities.crons` first and call `sdk.error(reason)` + `return` when it is `false`.

#### Scenario: Plugin self-checks and bows out

- **GIVEN** `config.cron.enabled` is `false`
- **WHEN** the trivia plugin's init function runs
- **THEN** the plugin SHALL read `sdk.capabilities.crons`
- **AND** observe that it is `false`
- **AND** call `sdk.error("Trivia requires the cron scheduler. Enable it via \`config.cron.enabled: true\`.")`
- **AND** return without invoking `sdk.reconcileCronJobs`
- **AND** no trivia entries are added to `data/state/cron-jobs.json`

#### Scenario: Plugin without self-check persists dead jobs

- **GIVEN** `config.cron.enabled` is `false`
- **AND** a plugin does NOT check `sdk.capabilities.crons`
- **WHEN** the plugin's init calls `sdk.reconcileCronJobs("p", specs)`
- **THEN** the SDK SHALL reconcile the persisted jobs as documented
- **AND** the jobs SHALL NOT fire because the scheduler is not running
- **AND** no error is raised by the SDK

#### Scenario: Reconciliation is normal when crons are enabled

- **GIVEN** `config.cron.enabled` is `true`
- **WHEN** a plugin calls `sdk.reconcileCronJobs("p", specs)`
- **THEN** the reconciliation proceeds exactly as documented elsewhere in this capability
- **AND** the jobs tick under the scheduler's normal cadence
