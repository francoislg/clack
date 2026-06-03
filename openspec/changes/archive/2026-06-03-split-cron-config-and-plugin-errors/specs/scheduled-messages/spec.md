## MODIFIED Requirements

### Requirement: Configuration Gate

The scheduled message tools SHALL only be available when `config.cron.userSchedules` is `true` AND `config.cron.enabled` is `true`. If `config.cron.enabled` is `false` and `config.cron.userSchedules` is `true`, the system SHALL log a warning at config load and treat `userSchedules` as `false` for the lifetime of that boot.

#### Scenario: Feature disabled (default)

- **WHEN** `config.cron.userSchedules` is not set or is `false`
- **THEN** the tool server does NOT register `schedule_reminder`, `list_reminders`, `cancel_reminder`, `create_scheduled_message`, `cancel_scheduled_message`, `list_scheduled_messages`, `update_scheduled_message`, `run_scheduled_message_now`, or `get_scheduled_message_runs`

#### Scenario: Feature enabled

- **WHEN** `config.cron.userSchedules` is `true`
- **AND** `config.cron.enabled` is `true`
- **AND** a Slack client is available in the tool context
- **THEN** the tool server registers all scheduled-message and reminder tools

#### Scenario: Feature enabled but no Slack client

- **WHEN** `config.cron.userSchedules` is `true`
- **AND** no Slack client is available (e.g., test context)
- **THEN** the tool server does NOT register the scheduled message tools

#### Scenario: Invalid combination coerced

- **WHEN** `config.cron.enabled` is `false`
- **AND** `config.cron.userSchedules` is `true`
- **THEN** the system SHALL log a warning naming both keys
- **AND** treat `userSchedules` as `false` for all gating decisions during that boot
- **AND** the persisted config file is NOT rewritten (the value is coerced in-memory only)
