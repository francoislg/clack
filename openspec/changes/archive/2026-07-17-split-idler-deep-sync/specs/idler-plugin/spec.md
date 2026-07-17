# idler-plugin — Delta

## MODIFIED Requirements

### Requirement: Four cooperating scheduled tasks

The plugin SHALL own up to five distinct cron specs — a **light sync** task (specKey `sync-light`), a **deep sync** task (specKey `sync`, the maintenance pass), a **discovery sync** task (specKey `sync-discovery`), a **work** task (every ~15 minutes inside `workHours`), and a **summary** task (end of window) — each with its own prompt and `requiredTools`. The work task's `requiredTools` SHALL include the change-proposing and review tools; the sync and summary tasks SHALL NOT include change-proposing tools and SHALL NOT acquire a worktree. All sync specs SHALL be channelless with `submitResponseMode: "skipped"`.

The **deep sync** task SHALL fire exactly once per sync-window day, at the **anchor hour**: the last sync-window hour before the work window opens — `(workHours.start - 1) mod 24` when the sync window is the derived complement of `workHours`, or the window's own last hour `(syncHours.end - 1) mod 24` when an explicit `syncHours` window is configured.

The **discovery sync** task SHALL fire exactly once per sync-window day at the **discovery hour** `(anchor − syncEveryHours) mod 24`, PROVIDED that hour is a member of the thinned sync schedule and distinct from the anchor. When no such hour exists (e.g. a single-hour or too-small sync window), the discovery spec SHALL NOT be reconciled and the deep sync task SHALL run the combined maintenance-plus-discovery pass (the pre-split behavior) — coverage never regresses.

The **light sync** task SHALL fire at the `syncEveryHours` cadence (integer 1–12, default 2) across the remaining sync-window hours, with thinning anchored on the anchor hour and BOTH the anchor hour and the discovery hour (when reconciled) excluded, so light ∪ discovery ∪ anchor equals the thinned sync schedule with each hour owned by exactly one spec. When the sync window contains only the anchor hour, only the deep spec SHALL be reconciled.

The work task SHALL be reconciled with its destination channel set to `reporting.channel`. When `reporting.tickUpdates` is `"none"`, the work task SHALL be marked silent so it produces no Slack output while still executing changes; when `"optional"`, it SHALL post per-tick progress as before. The summary task SHALL be reconciled only when `reporting.summary` is true.

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

### Requirement: Deep sync fire runs the full maintenance pass before the work window

When the discovery spec is reconciled, the deep sync fire SHALL run the maintenance pass ONLY: (a) **quick-fetch + close resolved** — list open Clack-authored pull requests on each allowlisted repo and re-run each tracked unit's references' `howToRead` (PR references per the canonical PR review check), closing units whose surface reads resolved/merged/closed (`open:false` with a short grace `staleAfter`, ~2 days); (b) **coldest-unit re-verification, stale parking, and priority recompute** for open units (per the `idler-ideas-ledger` "Sync-recomputed priority", "Coldest-first ordering", and "Concierge parks stale units" requirements, all of which resolve to the deep fire); and (c) **memory triage** (per "Recently-updated memory scan during sync"). The maintenance prompt SHALL NOT interpolate the admin fetch-instructions document and SHALL NOT perform external discovery. When the discovery spec is NOT reconciled (fallback), the deep fire SHALL additionally run the full external discovery pass exactly as specified for the discovery fire, and its prompt SHALL interpolate the admin fetch-instructions document. The pass SHALL NOT modify the unit the work fire is actively advancing.

#### Scenario: Resolved tracked unit is closed during the deep fire

- **GIVEN** a tracked open unit whose PR is now merged
- **WHEN** the deep sync fire runs its quick-fetch
- **THEN** the unit is closed (`open:false`) with a short grace `staleAfter`
- **AND** it is no longer selectable by the work fire

#### Scenario: Maintenance prompt carries no fetch instructions in the split layout

- **GIVEN** the discovery spec is reconciled
- **WHEN** the deep sync prompt is built
- **THEN** it does not interpolate `fetch-instructions.md` and contains no external-discovery instructions

#### Scenario: Deep pass respects work-task authority

- **GIVEN** the work fire is actively advancing unit `X`
- **WHEN** the deep sync pass runs and `X`'s surface now reads resolved
- **THEN** the deep pass does NOT close `X`
- **AND** a later fire closes `X` once it is no longer being advanced

#### Scenario: Discovered units are priced by the following maintenance fire

- **GIVEN** the discovery fire created new units at the discovery hour
- **WHEN** the deep sync (maintenance) fire runs at the anchor hour
- **THEN** its priority recompute covers those units, so the first work fire selects from a fully-primed ledger

## ADDED Requirements

### Requirement: Discovery sync fire scans all enabled sources

The discovery sync fire SHALL perform external discovery covering ALL enabled sources (channels, tracker, own PRs) in one fire — not a round-robin — per the admin fetch-instructions document, which SHALL be interpolated into its prompt. For each NEW item (no live memory entry) it SHALL first check `get_archived` by stable id (enriching on a hit, never skipping), then create the unit via `upsert_idea` keyed by the stable source-entity id with populated reference recipes, what/why, and a best-guess `staleAfter`. The discovery fire SHALL NOT run memory triage, the coldest rotation, or quick-fetch/close-resolved — those belong to the maintenance fire. It SHALL make no code changes and post nothing to any channel, ending via `skip_response`.

#### Scenario: All enabled discovery sources are scanned each discovery fire

- **GIVEN** a discovery channel, the tracker source, and the own-PRs source are all enabled
- **WHEN** the discovery sync fire runs
- **THEN** all three sources are scanned in that fire rather than rotated across fires

#### Scenario: Mid-day external events are discovered before the work window

- **GIVEN** a Sentry alert posted to a discovery channel during light-sync hours
- **WHEN** the discovery sync fire runs at the discovery hour
- **THEN** the alert is discovered and keyed as a unit before the work window opens

#### Scenario: Discovery fire does no maintenance

- **WHEN** the discovery sync fire runs
- **THEN** it does not run memory triage, does not re-verify coldest units, and does not close resolved units

### Requirement: Deep-tier sync prompts carry warm-up and result-budget directives

Every deep-tier sync prompt (deep/maintenance, discovery, and the combined fallback) SHALL include: (a) a **batched warm-up directive** — identify every deferred tool schema the fire needs and load them ALL in a single message of batched `ToolSearch` calls, never one `ToolSearch` per turn; and (b) **result-budget directives** — page `fetch_channel_messages` with an explicit small limit, use `Read` with line ranges rather than whole files, prefer targeted Grep during re-verification, and on a file-offloaded oversized result re-call the tool with a smaller limit instead of reading the offload file. The light prompt is exempt: its toolbelt is always-on (nothing to warm up) and its existing hard-budget rules (recall cap, no codebase reads, offload-file ban) are stricter than the shared directives.

#### Scenario: Prompts instruct a single batched schema warm-up

- **WHEN** the maintenance, discovery, or combined deep sync prompt is built
- **THEN** it directs Claude to load all needed deferred tool schemas in one batched ToolSearch message

#### Scenario: Prompts bound fat results

- **WHEN** the discovery or deep sync prompt is built
- **THEN** it directs paging channel fetches with an explicit limit and bounded Reads, and forbids reading offloaded oversized results
