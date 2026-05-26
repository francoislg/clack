## ADDED Requirements

### Requirement: Trivia Plugin Self-Disables When Crons Are Off

The trivia plugin's init function SHALL inspect `sdk.capabilities.crons` before performing any registrations. When the capability is `false`, the plugin SHALL:

- Call `sdk.error("Trivia requires the cron scheduler. Enable it via \`config.cron.enabled: true\`.")` exactly once.
- Return from init without calling `sdk.reconcileCronJobs`, `sdk.registerTool`, `sdk.addInstruction`, `sdk.addTopicInstruction`, or `sdk.registerIntegration`.

The user-visible reason text SHALL name the config key (`config.cron.enabled`) so an admin reading the Home Tab error banner can fix the misconfiguration without consulting external docs.

#### Scenario: Trivia init bows out when crons disabled

- **GIVEN** `config.cron.enabled` is `false`
- **WHEN** the trivia plugin's init runs
- **THEN** the plugin calls `sdk.error` once with the documented reason text
- **AND** the plugin returns
- **AND** no trivia tools are registered
- **AND** no trivia instructions are registered
- **AND** no trivia integrations are registered
- **AND** `data/state/cron-jobs.json` is unchanged with respect to trivia entries

#### Scenario: Trivia loads normally when crons enabled

- **GIVEN** `config.cron.enabled` is `true`
- **WHEN** the trivia plugin's init runs
- **THEN** the plugin SHALL NOT call `sdk.error` due to the cron capability
- **AND** all trivia tools, instructions, integrations, and cron specs SHALL register as they do today

#### Scenario: Plugin status visible to admin

- **GIVEN** `config.cron.enabled` is `false`
- **AND** the trivia plugin has bowed out via `sdk.error`
- **WHEN** an admin opens the Home Tab
- **THEN** the `Status > Plugins` section shows the trivia row with an error banner containing the documented reason text
