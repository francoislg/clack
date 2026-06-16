## ADDED Requirements

### Requirement: Reporting controls

The plugin SHALL expose a grouped `reporting` configuration block that governs all Slack output. The block SHALL contain `channel` (the destination for any posts; absent ⇒ the plugin is dormant), `tickUpdates` (`"none" | "optional"`, default `"none"`), `summary` (boolean, default `true`), and `summaryHour` (hour 0–23, default 9, applied only when `summary` is true). The `reporting` block SHALL absorb the previously top-level `reportingChannel` and `summaryHour` fields; a config file that still carries those at the top level (with no `reporting` block) SHALL be accepted by lifting them into `reporting.channel`/`reporting.summaryHour`, so existing files keep working without a separate migration. When a `reporting` block is present, it SHALL take precedence and any legacy top-level `reportingChannel`/`summaryHour` SHALL be ignored (no lifting occurs). `isOperational` SHALL require `reporting.channel` to be present; a missing channel SHALL make the plugin dormant rather than causing a load error.

The two knobs SHALL be orthogonal, producing four behaviors:

- `tickUpdates: "none"` — the work fire produces NO per-tick Slack output (no narration, no status posts), yet still triages, reviews, and implements.
- `tickUpdates: "optional"` — the work fire posts per-tick progress when it acts and stays quiet when idle (the prior behavior).
- `summary: true` — the morning digest fires at `summaryHour`.
- `summary: false` — no summary cron spec is reconciled.

The activity ledger SHALL be written regardless of either knob, so the summary (when enabled) always reflects the window's work and re-enabling `summary` loses nothing within the window.

#### Scenario: Defaults are quiet ticks plus a digest

- **GIVEN** a config with a `reporting.channel` and no `tickUpdates`/`summary` overrides
- **WHEN** the plugin reconciles
- **THEN** `tickUpdates` defaults to `"none"` and `summary` to `true`
- **AND** the work fire posts no per-tick updates while the summary digest still fires

#### Scenario: Legacy top-level fields are accepted

- **GIVEN** an existing `config.json` with top-level `reportingChannel` and `summaryHour` and no `reporting` block
- **WHEN** the config is loaded
- **THEN** the values are lifted into `reporting.channel` and `reporting.summaryHour`
- **AND** the plugin operates without a load error

#### Scenario: Explicit reporting block wins over legacy fields

- **GIVEN** a `config.json` that has both a `reporting` block and legacy top-level `reportingChannel`/`summaryHour`
- **WHEN** the config is loaded
- **THEN** the `reporting` block is used as-is and the legacy top-level fields are ignored

#### Scenario: Tick-only configuration

- **GIVEN** `reporting.tickUpdates: "optional"` and `reporting.summary: false`
- **WHEN** the plugin reconciles
- **THEN** the work fire posts per-tick progress
- **AND** no summary cron spec is reconciled

#### Scenario: Fully silent configuration

- **GIVEN** `reporting.tickUpdates: "none"` and `reporting.summary: false`
- **WHEN** the work fire opens a pull request
- **THEN** nothing is posted to any Slack channel
- **AND** the action is still recorded in the activity ledger

#### Scenario: Missing channel is dormant, not an error

- **GIVEN** a config whose `reporting.channel` is absent
- **WHEN** the plugin loads and reconciles
- **THEN** no error is raised and no idler cron specs are reconciled

## MODIFIED Requirements

### Requirement: Three cooperating scheduled tasks

The plugin SHALL own up to three distinct cron specs — a **sync** task (hourly), a **work** task (every ~15 minutes), and a **summary** task (end of window) — each with its own prompt and `requiredTools`. The work task's `requiredTools` SHALL include the change-proposing and review tools; the sync and summary tasks SHALL NOT include change-proposing tools and SHALL NOT acquire a worktree. The work task SHALL be reconciled with its destination channel set to `reporting.channel`. When `reporting.tickUpdates` is `"none"`, the work task SHALL be marked silent so it produces no Slack output while still executing changes; when `"optional"`, it SHALL post per-tick progress as before. The summary task SHALL be reconciled only when `reporting.summary` is true.

#### Scenario: Sync task refreshes the backlog read-only

- **WHEN** the sync task fires
- **THEN** it discovers and re-polls work units
- **AND** it does not acquire a worktree or push any code

#### Scenario: Work task advances exactly one unit per fire

- **WHEN** the work task fires and at least one workable unit exists
- **THEN** it advances exactly one work unit by a single step
- **AND** at most one change executes concurrently across fires

#### Scenario: Work task may do nothing

- **GIVEN** no workable unit exists this fire
- **WHEN** the work task fires
- **THEN** it terminates without proposing a change and without error

#### Scenario: Silent work fire posts nothing yet still implements

- **GIVEN** `reporting.tickUpdates: "none"` and a workable implement unit
- **WHEN** the work task fires
- **THEN** it executes the change (commits/PR) without posting any per-tick message or status to Slack
- **AND** records the action in the activity ledger

#### Scenario: Summary task is omitted when disabled

- **GIVEN** `reporting.summary: false`
- **WHEN** reconciliation runs
- **THEN** no summary cron spec is reconciled

#### Scenario: Summary task reports activity

- **GIVEN** `reporting.summary: true`
- **WHEN** the summary task fires
- **THEN** it reads the activity log and posts a digest to `reporting.channel`

### Requirement: Activity logging and summary digest

The plugin SHALL append every autonomous action (PR opened, comments addressed, review/approval posted, unit parked with reason, failure) to an activity log, regardless of the `reporting.tickUpdates` value. When `reporting.summary` is true, the summary task SHALL read that log and post a digest including PRs opened, comments addressed, reviews/approvals, parked units with reasons, a ready-to-merge list, and failures. When `reporting.summary` is false, no digest is posted and the log accumulates until the next enabled summary.

#### Scenario: Actions are logged even when silent

- **GIVEN** `reporting.tickUpdates: "none"`
- **WHEN** the work task takes an autonomous action
- **THEN** an entry describing it is appended to the activity log

#### Scenario: Summary digest covers the window

- **GIVEN** `reporting.summary: true`
- **WHEN** the summary task fires
- **THEN** its digest reflects the logged actions for the window, including a ready-to-merge list
