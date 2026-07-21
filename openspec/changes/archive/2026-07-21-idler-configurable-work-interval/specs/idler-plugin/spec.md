# idler-plugin Delta

## ADDED Requirements

### Requirement: Configurable work-fire cadence

The idler config SHALL expose a `workEveryMinutes` field — the number of minutes between work-task fires inside `workHours`. The value MUST be an integer divisor of 60 within [5, 60] (`5, 6, 10, 12, 15, 20, 30, 60`) so every accepted cadence tiles each hour evenly; validation SHALL reject any other value with an error naming the accepted set, never silently snapping. The field SHALL default to `30` when absent. The admin-gated `set_idler_config` tool SHALL accept a `workEveryMinutes` argument validated through the same schema, and a saved change SHALL take effect through the existing config-watcher → re-reconcile path without a restart.

#### Scenario: Absent field defaults to 30

- **GIVEN** an idler config file without `workEveryMinutes`
- **WHEN** the config is loaded
- **THEN** `workEveryMinutes` parses to `30`

#### Scenario: Non-divisor cadence is rejected

- **WHEN** a config with `workEveryMinutes: 25` is validated
- **THEN** validation fails with an error naming the accepted divisors (`5, 6, 10, 12, 15, 20, 30, 60`)

#### Scenario: Out-of-range cadence is rejected

- **WHEN** a config with `workEveryMinutes: 4` or `workEveryMinutes: 61` is validated
- **THEN** validation fails

#### Scenario: Cadence change hot-reloads

- **GIVEN** a running idler with `workEveryMinutes: 30`
- **WHEN** an admin sets `workEveryMinutes: 15` via `set_idler_config`
- **THEN** the config is re-validated and saved, and the next reconcile rebuilds the work spec at the new cadence without a process restart

## MODIFIED Requirements

### Requirement: Four cooperating scheduled tasks

The plugin SHALL own up to five distinct cron specs — a **light sync** task (specKey `sync-light`), a **deep sync** task (specKey `sync`, the maintenance pass), a **discovery sync** task (specKey `sync-discovery`), a **work** task (every `workEveryMinutes` minutes inside `workHours`, default 30), and a **summary** task (end of window) — each with its own prompt and `requiredTools`. The work task's `requiredTools` SHALL include the change-proposing and review tools; the sync and summary tasks SHALL NOT include change-proposing tools and SHALL NOT acquire a worktree. All sync specs SHALL be channelless with `submitResponseMode: "skipped"`.

The **deep sync** task SHALL fire exactly once per sync-window day, at the **anchor hour**: the last sync-window hour before the work window opens — `(workHours.start - 1) mod 24` when the sync window is the derived complement of `workHours`, or the window's own last hour `(syncHours.end - 1) mod 24` when an explicit `syncHours` window is configured.

The **discovery sync** task SHALL fire exactly once per sync-window day at the **discovery hour** `(anchor − syncEveryHours) mod 24`, PROVIDED that hour is a member of the thinned sync schedule and distinct from the anchor. When no such hour exists (e.g. a single-hour or too-small sync window), the discovery spec SHALL NOT be reconciled and the deep sync task SHALL run the combined maintenance-plus-discovery pass (the pre-split behavior) — coverage never regresses.

The **light sync** task SHALL fire at the `syncEveryHours` cadence (integer 1–12, default 2) across the remaining sync-window hours, with thinning anchored on the anchor hour and BOTH the anchor hour and the discovery hour (when reconciled) excluded, so light ∪ discovery ∪ anchor equals the thinned sync schedule with each hour owned by exactly one spec. When the sync window contains only the anchor hour, only the deep spec SHALL be reconciled.

The work task SHALL be reconciled with its destination channel set to `reporting.channel`, and its cron minute field SHALL be derived from the configured `workEveryMinutes` (`*/N`). When `reporting.tickUpdates` is `"none"`, the work task SHALL be marked silent so it produces no Slack output while still executing changes; when `"optional"`, it SHALL post per-tick progress as before. The summary task SHALL be reconciled only when `reporting.summary` is true.

#### Scenario: Deep sync fires once per window-day at the anchor hour

- **GIVEN** `workHours` 18→6 with no explicit `syncHours`
- **WHEN** the plugin reconciles
- **THEN** the deep sync spec's cron fires only at hour 17 (the last complement hour before 18:00)

#### Scenario: Discovery sync fires at the slot before the anchor

- **GIVEN** `workHours` 18→6 and `syncEveryHours: 2`
- **WHEN** the plugin reconciles
- **THEN** the discovery spec's cron fires only at hour 15 (anchor 17 minus the 2-hour cadence)
- **AND** the light sync spec fires at hours 7, 9, 11, and 13 (the thinned complement hours excluding both 15 and 17)

#### Scenario: Too-small sync window falls back to the combined fire

- **GIVEN** a sync window whose thinned schedule contains no eligible discovery hour distinct from the anchor
- **WHEN** the plugin reconciles
- **THEN** no discovery spec is created
- **AND** the deep sync spec's prompt is the combined maintenance-plus-discovery pass (pre-split behavior)

#### Scenario: Light sync excludes the anchor hour and honors the cadence

- **GIVEN** `workHours` 18→6 and `syncEveryHours: 2`
- **WHEN** the plugin reconciles
- **THEN** the light sync spec fires at hours 7, 9, 11, and 13 (every 2nd complement hour walking back from the anchor; anchor and discovery hours excluded)

#### Scenario: Fallback implies a deep-only layout

- **GIVEN** a configuration where no eligible discovery hour exists (fallback layout)
- **WHEN** the plugin reconciles
- **THEN** no light sync spec exists either — sync windows are contiguous, so a discovery candidate outside the thinned schedule means the thinned schedule is the anchor alone, and the deep (combined) spec is the only sync spec

#### Scenario: Explicit small sync window triggers the discovery fallback

- **GIVEN** an explicit `syncHours` window of 16→18 (hours 16 and 17) and `syncEveryHours: 2`
- **WHEN** the plugin reconciles
- **THEN** no discovery spec is created (the candidate hour 15 lies outside the sync window)
- **AND** the deep sync spec at anchor hour 17 carries the combined prompt

#### Scenario: Single-hour sync window reconciles only the deep spec

- **GIVEN** a sync window containing exactly one hour
- **WHEN** the plugin reconciles
- **THEN** only the deep sync spec is created and no light or discovery sync spec exists

#### Scenario: Sync tasks are read-only

- **WHEN** a light, deep, or discovery sync task fires
- **THEN** it does not acquire a worktree and does not push any code

#### Scenario: Configured cadence drives the work cron

- **GIVEN** `workHours` 18→6 and `workEveryMinutes: 30`
- **WHEN** the plugin reconciles
- **THEN** the work spec's cron minute field is `*/30` across the work-window hours

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
