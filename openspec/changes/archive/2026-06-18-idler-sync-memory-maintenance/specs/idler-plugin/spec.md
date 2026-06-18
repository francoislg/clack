## ADDED Requirements

### Requirement: Every-fire memory-maintenance pass

Every sync run SHALL perform an unconditional memory-maintenance pass — independent of the external-discovery round-robin and run on every fire — that keeps the idler's adopted units and recently-changed memory current. The pass SHALL, in order: (a) **close resolved units** — for each tracked unit whose references' `howToRead` shows its surface resolved/merged/closed, close it (`open:false` with a short grace `staleAfter`, ~2 days), the same close move the work fire uses; (b) **triage recently-changed memory** — adopt or ignore candidates from a recency-ordered page (per "Recently-updated memory scan during sync"); and (c) **recompute priority** for open units (per the `idler-ideas-ledger` "Sync-recomputed priority" requirement). Step (b) SHALL be gated by `sources.scanMemory`; steps (a) and (c) SHALL run regardless of `sources.scanMemory`. The pass SHALL NOT introduce new persisted state and SHALL NOT add a new tool. The pass SHALL NOT modify the unit the work fire is actively advancing (the existing work-task authority rule continues to apply).

#### Scenario: Maintenance runs every fire regardless of the round-robin

- **WHEN** any sync fire runs
- **THEN** the close-resolved, triage-new, and recompute steps all execute that fire
- **AND** they do not consume or depend on the external-discovery round-robin slot

#### Scenario: Resolved tracked unit is closed during sync

- **GIVEN** a tracked open unit whose `howToRead` now shows its PR merged (or its source issue resolved)
- **WHEN** the sync fire runs its maintenance pass
- **THEN** the unit is closed (`open:false`) with a short grace `staleAfter`
- **AND** it is no longer selectable by the work fire

#### Scenario: Maintenance still runs when discovery is gated off

- **GIVEN** `sources.scanMemory` is `false`
- **WHEN** the sync fire runs
- **THEN** resolved tracked units are still closed and open units are still re-prioritized
- **AND** only the triage/adoption of newly-changed memory entries is skipped

#### Scenario: Close-resolved respects work-task authority

- **GIVEN** the work fire is actively advancing unit `X`
- **WHEN** the sync maintenance pass runs and `X`'s surface now reads resolved
- **THEN** the sync pass does NOT close `X` (the work-task authority rule protects the in-flight unit)
- **AND** a later sync fire (or the work fire itself) closes `X` once it is no longer being advanced

## MODIFIED Requirements

### Requirement: Layered incremental sync

The sync task SHALL perform a cheap quick-fetch on every run — listing open Clack-authored pull requests (filtered by author login and/or branch prefix) and re-polling each tracked unit's references via their `howToRead` — and SHALL spread deeper **external** discovery (channel scans, tracker polls, own-PR inspection) across runs rather than re-scanning every external source every run. Memory maintenance is NOT part of this rotation: closing resolved units, triaging new memory, and recomputing priority run on every fire (see "Every-fire memory-maintenance pass"), not as a round-robin arm.

#### Scenario: Quick-fetch every run

- **WHEN** the sync task fires
- **THEN** it lists open Clack PRs and refreshes their references' status
- **AND** advances per-reference cursors for any new activity

#### Scenario: External discovery is incremental

- **GIVEN** multiple configured external discovery sources (channels, tracker, own PRs)
- **WHEN** successive sync runs fire through the window
- **THEN** external discovery is rotated across runs (round-robin over the configured external sources) rather than re-scanning all of them on every run
- **AND** each configured external source is discovered at least once per off-hours window

#### Scenario: Memory maintenance is not rotated

- **WHEN** successive sync runs fire through the window
- **THEN** the memory-maintenance pass runs on each fire
- **AND** it is never deferred to a later fire by the external round-robin

### Requirement: Recently-updated memory scan during sync

When `sources.scanMemory` is enabled, the sync task's memory-maintenance pass SHALL, on **every fire** (not as one round-robin arm), triage recently-changed memory — reading a generous recency-ordered page via the existing `recall` tool (no query, newest `updatedAt` first), classifying the whole page from each entry's idler slice, and THEN taking up to a small number of candidates (classify-then-take, so it slides past already-triaged newest entries to reach older untriaged ones). A candidate SHALL be adopted as a work unit via `upsert_idea` — keyed by its existing stable id, with the same `getArchived` regression-enrichment as other sources — only when it is clearly actionable AND concerns an allowlisted repo; otherwise the sync SHALL mark it as not-idler-work rather than adopt it. Because `remember` stamps the current time on every content write, newly-remembered or re-remembered entries sort to the top of the page, so an every-fire scan reliably catches new memory without a persisted cursor. The scan SHALL NOT introduce a new tool and SHALL NOT modify the core `recall` or `remember` tools.

#### Scenario: Actionable memory entry is adopted

- **GIVEN** `sources.scanMemory` is enabled and a recently-updated untriaged memory entry keyed `sentry:1234` describes a fixable error in an allowlisted repo
- **WHEN** the sync maintenance pass runs
- **THEN** a work unit is created (or the existing entry adopted) via `upsert_idea` keyed by `sentry:1234`, enriched with any archived prior outcome

#### Scenario: Non-work memory entry is marked not-idler-work

- **GIVEN** an untriaged memory entry that is a user preference or note, not actionable work
- **WHEN** the sync maintenance pass runs
- **THEN** it is marked as not-idler-work and no work unit is created for it

#### Scenario: Out-of-allowlist entry is not adopted

- **GIVEN** an untriaged memory entry describing work in a repo not on the allowlist
- **WHEN** the sync maintenance pass runs
- **THEN** it is not adopted as an actionable unit

#### Scenario: Unchanged not-work entries are not re-triaged

- **GIVEN** a memory entry previously marked not-idler-work, whose `ignoredAt` still equals its `updatedAt` (the ignore write did not advance `updatedAt`)
- **WHEN** the sync maintenance pass scans the page on a later fire
- **THEN** that entry is classified as a non-candidate and not re-triaged
- **AND** it re-qualifies only once a genuine content write advances its `updatedAt` past `ignoredAt`

### Requirement: Configurable work sources

The plugin SHALL support sourcing candidate work from: configured Slack channels (unhandled issues/requests, including bot-posted alert channels such as a Sentry `#sentry-alerts` channel), an external tracker via MCP (e.g. Asana tasks or Sentry issues), Clack's own open pull requests, recently-updated core memory entries (gated by `sources.scanMemory`, default `true`), and a free-form admin fetch-instruction document. The mapping from a source to a ledger reference's `howToRead`/`howToComment` recipe SHALL be driven by the fetch instructions, not hard-coded per source. When a channel source carries bot-posted alerts whose detail lives in attachments/blocks, the plugin SHALL extract the entity (e.g. the Sentry issue title + short-id/URL) — reading the message permalink via `fetch_slack_message` when the channel overview is insufficient — and key the unit by the entity's stable id. The `sources.scanMemory` flag SHALL default to `true`, and a persisted `sources` object lacking the field SHALL be read as `true`.

#### Scenario: Slack channel issue becomes a unit

- **GIVEN** a configured channel contains an unhandled request per the fetch instructions
- **WHEN** sync discovers it
- **THEN** a work unit is created with a Slack reference carrying its read/comment recipe

#### Scenario: Tracker task becomes a unit

- **GIVEN** an external tracker MCP is installed and a matching task exists per the fetch instructions
- **WHEN** sync discovers it
- **THEN** a work unit is created with a tracker reference carrying its read/comment recipe

#### Scenario: New source type needs no code change

- **GIVEN** the fetch instructions describe a tracker not previously used
- **WHEN** sync runs
- **THEN** it writes the appropriate `howToRead`/`howToComment` recipe for that source without an idler code change

#### Scenario: Sentry alert channel becomes an issue-keyed unit

- **GIVEN** a `#sentry-alerts` channel configured as a source
- **WHEN** sync reads a Sentry alert and extracts the issue short-id/URL
- **THEN** a unit keyed by the Sentry issue id is created (or updated if it already exists)
- **AND** its reference `howToRead` uses a Sentry MCP when installed, else degrades to the Slack message + linked Sentry URL

#### Scenario: Memory source is gated by config

- **GIVEN** `sources.scanMemory` is `false`
- **WHEN** sync runs
- **THEN** the every-fire memory triage of new entries is skipped and no memory entry is adopted from it
- **AND** all other configured sources, and the close-resolved/recompute maintenance steps, are unaffected
- **AND** units already adopted while `scanMemory` was enabled remain open and eligible for work (the gate suppresses new adoptions only, never abandons existing units)
