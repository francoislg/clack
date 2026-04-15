## ADDED Requirements

### Requirement: Channel Input Resolution for Scheduled Message Creation

The `create_scheduled_message` tool SHALL resolve its `channel` argument via the shared `resolveChannelId` helper before persisting a cron job, guaranteeing that the stored `channel` field is always a posting-capable Slack channel ID (never a raw user ID).

#### Scenario: Channel name resolved before persistence

- **WHEN** Claude calls `create_scheduled_message` with a channel name (e.g., `#ops` or `ops`)
- **THEN** the tool delegates resolution to the shared `resolveChannelId` helper
- **AND** the resolved channel ID is stored on the cron job's `channel` field
- **AND** the raw name is NOT stored

#### Scenario: Channel ID passthrough

- **WHEN** Claude provides a channel ID (`C…`, `G…`, or `D…`)
- **THEN** the tool stores it directly on the cron job's `channel` field

#### Scenario: Self-DM user ID normalized

- **WHEN** Claude provides a user ID (`U…`) equal to the requesting user
- **THEN** the tool opens a DM via `openDmChannel` before creating the cron job
- **AND** stores the resulting `D…` channel ID on the cron job's `channel` field
- **AND** the raw user ID is NEVER stored

#### Scenario: Third-party user ID rejected

- **WHEN** Claude provides a user ID (`U…`) that does NOT match the requesting user
- **THEN** the tool returns an error explaining that only self-DMs are supported
- **AND** no cron job is created

#### Scenario: Resolution failure blocks creation

- **WHEN** channel resolution fails (e.g., channel not found, DM open error)
- **THEN** the tool returns the resolution error to Claude
- **AND** no cron job is created
