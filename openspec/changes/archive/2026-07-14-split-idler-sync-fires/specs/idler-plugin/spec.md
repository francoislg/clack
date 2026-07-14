# idler-plugin — delta for split-idler-sync-fires

## ADDED Requirements

### Requirement: Four cooperating scheduled tasks

The plugin SHALL own up to four distinct cron specs — a **light sync** task (specKey `sync-light`), a **deep sync** task (specKey `sync`), a **work** task (every ~15 minutes inside `workHours`), and a **summary** task (end of window) — each with its own prompt and `requiredTools`. The work task's `requiredTools` SHALL include the change-proposing and review tools; the sync and summary tasks SHALL NOT include change-proposing tools and SHALL NOT acquire a worktree. Both sync specs SHALL be channelless with `submitResponseMode: "skipped"`.

The **deep sync** task SHALL fire exactly once per sync-window day, at the **anchor hour**: the last sync-window hour before the work window opens — `(workHours.start - 1) mod 24` when the sync window is the derived complement of `workHours`, or the window's own last hour `(syncHours.end - 1) mod 24` when an explicit `syncHours` window is configured. The **light sync** task SHALL fire at the `syncEveryHours` cadence (integer 1–12, default 2) across the remaining sync-window hours, with thinning anchored on the anchor hour and the anchor hour itself excluded, so the union of light and deep fire hours equals the thinned sync schedule. When the sync window contains only the anchor hour, only the deep spec SHALL be reconciled.

The work task SHALL be reconciled with its destination channel set to `reporting.channel`. When `reporting.tickUpdates` is `"none"`, the work task SHALL be marked silent so it produces no Slack output while still executing changes; when `"optional"`, it SHALL post per-tick progress as before. The summary task SHALL be reconciled only when `reporting.summary` is true.

#### Scenario: Deep sync fires once per window-day at the anchor hour

- **GIVEN** `workHours` 18→6 with no explicit `syncHours`
- **WHEN** the plugin reconciles
- **THEN** the deep sync spec's cron fires only at hour 17 (the last complement hour before 18:00)

#### Scenario: Light sync excludes the anchor hour and honors the cadence

- **GIVEN** `workHours` 18→6 and `syncEveryHours: 2`
- **WHEN** the plugin reconciles
- **THEN** the light sync spec fires at hours 7, 9, 11, 13, and 15 (every 2nd complement hour walking back from the anchor, anchor excluded)

#### Scenario: Single-hour sync window reconciles only the deep spec

- **GIVEN** a sync window containing exactly one hour
- **WHEN** the plugin reconciles
- **THEN** only the deep sync spec is created and no light sync spec exists

#### Scenario: Sync tasks are read-only

- **WHEN** a light or deep sync task fires
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

### Requirement: Light sync fire is memory-triage-only with early exit

The light sync fire SHALL perform ONLY the recently-updated memory triage: read one recency-ordered `recall` page (no query, newest `updatedAt` first), classify the whole page from each entry's idler slice markers, and adopt or ignore up to a small number of candidates per the existing triage rules. When classification yields NO candidates, the fire SHALL end immediately via `skip_response`, framed in the prompt as the expected common outcome. The light fire SHALL NOT list pull requests, SHALL NOT re-run tracked units' reference recipes, SHALL NOT run the coldest-unit rotation, and SHALL NOT perform external discovery. The light sync prompt SHALL NOT embed the admin fetch-instructions document; the behavior topic remains attached.

#### Scenario: Nothing new ends the fire immediately

- **GIVEN** every entry on the recall page is already triaged (tracked slice, or `ignoredAt` equal to `updatedAt`)
- **WHEN** a light sync fire runs
- **THEN** it calls `skip_response` right after classification, with no PR probes, no discovery, and no coldest-unit reads

#### Scenario: Newly-remembered work is adopted mid-day

- **GIVEN** a Q&A session remembered an actionable, allowlist-repo work item since the previous sync fire
- **WHEN** the next light sync fire runs
- **THEN** the entry is adopted as a work unit (with `get_archived` enrichment and stable-id keying), within the configured cadence latency

#### Scenario: Light prompt carries no fetch instructions

- **WHEN** the light sync prompt is built
- **THEN** it does not interpolate `fetch-instructions.md`
- **AND** it still carries the repo allowlist needed for triage classification

### Requirement: Deep sync fire runs the full maintenance pass before the work window

The deep sync fire SHALL run the full maintenance pass: (a) **quick-fetch + close resolved** — list open Clack-authored pull requests on each allowlisted repo and re-run each tracked unit's references' `howToRead` (PR references per the canonical PR review check), closing units whose surface reads resolved/merged/closed (`open:false` with a short grace `staleAfter`, ~2 days); (b) **coldest-unit re-verification, stale parking, and priority recompute** for open units (per the `idler-ideas-ledger` "Sync-recomputed priority", "Coldest-first ordering", and "Concierge parks stale units" requirements, all of which resolve to the deep fire); (c) **memory triage** (per "Recently-updated memory scan during sync"); and (d) **external discovery covering ALL enabled sources** (channels, tracker, own PRs) in the same fire — not a round-robin — since the deep fire is the only fire that scans. The pass SHALL NOT modify the unit the work fire is actively advancing.

#### Scenario: Resolved tracked unit is closed during the deep fire

- **GIVEN** a tracked open unit whose PR is now merged
- **WHEN** the deep sync fire runs its quick-fetch
- **THEN** the unit is closed (`open:false`) with a short grace `staleAfter`
- **AND** it is no longer selectable by the work fire

#### Scenario: All enabled discovery sources are scanned each deep fire

- **GIVEN** a discovery channel, the tracker source, and the own-PRs source are all enabled
- **WHEN** the deep sync fire runs
- **THEN** all three sources are scanned in that fire rather than rotated across fires

#### Scenario: Mid-day external events are discovered by the deep fire

- **GIVEN** a Sentry alert posted to a discovery channel during light-sync hours
- **WHEN** the deep sync fire runs at the anchor hour
- **THEN** the alert is discovered and keyed as a unit before the work window opens

#### Scenario: Deep pass respects work-task authority

- **GIVEN** the work fire is actively advancing unit `X`
- **WHEN** the deep sync pass runs and `X`'s surface now reads resolved
- **THEN** the deep pass does NOT close `X`
- **AND** a later fire closes `X` once it is no longer being advanced

## MODIFIED Requirements

### Requirement: Recently-updated memory scan during sync

When `sources.scanMemory` is enabled, EVERY sync fire — light and deep — SHALL triage recently-changed memory: reading a generous recency-ordered page via the existing `recall` tool (no query, newest `updatedAt` first), classifying the whole page from each entry's idler slice, and THEN taking up to a small number of candidates (classify-then-take, so it slides past already-triaged newest entries to reach older untriaged ones). A candidate SHALL be adopted as a work unit via `upsert_idea` — keyed by its existing stable id, with the same `getArchived` regression-enrichment as other sources — only when it is clearly actionable AND concerns an allowlisted repo; otherwise the sync SHALL mark it as not-idler-work rather than adopt it. On a LIGHT fire, an empty candidate set SHALL end the fire immediately (per "Light sync fire is memory-triage-only with early exit"); on a DEEP fire, the rest of the maintenance pass proceeds regardless. Because `remember` stamps the current time on every content write, newly-remembered or re-remembered entries sort to the top of the page, so the scan reliably catches new memory without a persisted cursor. The scan SHALL NOT introduce a new tool and SHALL NOT modify the core `recall` or `remember` tools.

#### Scenario: Actionable memory entry is adopted

- **GIVEN** `sources.scanMemory` is enabled and a recently-updated untriaged memory entry keyed `sentry:1234` describes a fixable error in an allowlisted repo
- **WHEN** any sync fire's triage runs
- **THEN** a work unit is created (or the existing entry adopted) via `upsert_idea` keyed by `sentry:1234`, enriched with any archived prior outcome

#### Scenario: Non-work memory entry is marked not-idler-work

- **GIVEN** an untriaged memory entry that is a user preference or note, not actionable work
- **WHEN** any sync fire's triage runs
- **THEN** it is marked as not-idler-work and no work unit is created for it

#### Scenario: Out-of-allowlist entry is not adopted

- **GIVEN** an untriaged memory entry describing work in a repo not on the allowlist
- **WHEN** any sync fire's triage runs
- **THEN** it is not adopted as an actionable unit

#### Scenario: Unchanged not-work entries are not re-triaged

- **GIVEN** a memory entry previously marked not-idler-work, whose `ignoredAt` still equals its `updatedAt` (the ignore write did not advance `updatedAt`)
- **WHEN** a later sync fire scans the page
- **THEN** that entry is classified as a non-candidate and not re-triaged
- **AND** it re-qualifies only once a genuine content write advances its `updatedAt` past `ignoredAt`

#### Scenario: Triage runs on both tiers

- **WHEN** a light sync fire and, later, the deep sync fire run in the same window
- **THEN** both perform the memory triage step
- **AND** only the deep fire continues into quick-fetch, coldest rotation, and discovery

## REMOVED Requirements

### Requirement: Three cooperating scheduled tasks

**Reason**: Superseded by the light/deep sync split — the plugin now owns up to four cron specs.
**Migration**: See "Four cooperating scheduled tasks"; the work and summary clauses carry over unchanged.

### Requirement: Every-fire memory-maintenance pass

**Reason**: The unconditional every-fire full pass is the measured cost problem; maintenance is re-scoped by tier.
**Migration**: Memory triage stays every-fire (see the modified "Recently-updated memory scan during sync"); close-resolved and priority recompute move to "Deep sync fire runs the full maintenance pass before the work window".

### Requirement: Layered incremental sync

**Reason**: Quick-fetch-every-run and the external-discovery round-robin are replaced by the deep fire's once-per-window full scan of all enabled sources.
**Migration**: See "Deep sync fire runs the full maintenance pass before the work window".
