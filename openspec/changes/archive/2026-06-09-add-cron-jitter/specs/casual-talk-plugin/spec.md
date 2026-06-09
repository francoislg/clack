## ADDED Requirements

### Requirement: Casual Talk Internal Jitter Constant

The casual-talk plugin SHALL set `jitterMinutes` on its `chatter` `CronJobSpec` from a fixed internal constant (kept below the fixed 15-minute cron gap so adjacent fires cannot overlap), so casual-chatter fires no longer always land on the canonical quarter-hour slot. Jitter SHALL NOT be exposed as a `CasualTalkConfig` field — there is no admin knob, no config-schema entry, and no validation for it in the plugin. The plugin consumes the general cron `jitterMinutes` primitive; the chosen value lives in the plugin's own code.

#### Scenario: Chatter spec carries the internal jitter value

- **GIVEN** casual-talk is enabled with at least one channel
- **WHEN** the plugin reconciles its cron jobs
- **THEN** the `chatter` `CronJobSpec` SHALL carry a non-zero `jitterMinutes` equal to the plugin's internal constant
- **AND** the value SHALL be strictly less than 15 (the fixed cadence gap)

#### Scenario: Jitter is not a config field

- **GIVEN** a `data/plugins/casual-talk/config.json`
- **WHEN** the plugin loads and validates the config
- **THEN** `jitterMinutes` SHALL NOT be a recognized `CasualTalkConfig` field
- **AND** the resolved jitter applied to the cron spec SHALL be independent of the config file contents
