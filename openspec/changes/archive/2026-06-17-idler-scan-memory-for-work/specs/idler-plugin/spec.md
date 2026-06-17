## RENAMED Requirements

- FROM: `### Requirement: Four configurable work sources`
- TO: `### Requirement: Configurable work sources`

## MODIFIED Requirements

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
- **THEN** the memory-scan rotation entry is skipped and no memory entry is adopted from it
- **AND** all other configured sources are unaffected

### Requirement: Layered incremental sync

The sync task SHALL perform a cheap quick-fetch on every run — listing open Clack-authored pull requests (filtered by author login and/or branch prefix) and re-polling each tracked unit's references via their `howToRead` — and SHALL spread deeper discovery (channel scans, tracker polls, memory scans) across runs rather than re-scanning every source every run.

#### Scenario: Quick-fetch every run

- **WHEN** the sync task fires
- **THEN** it lists open Clack PRs and refreshes their references' status
- **AND** advances per-reference cursors for any new activity

#### Scenario: Discovery is incremental

- **GIVEN** multiple configured discovery sources
- **WHEN** successive sync runs fire through the window
- **THEN** discovery is rotated across runs (round-robin over the configured sources, including the memory scan when `sources.scanMemory` is enabled) rather than re-scanning all sources on every run
- **AND** each configured source is discovered at least once per off-hours window

## ADDED Requirements

### Requirement: Recently-updated memory scan during sync

When `sources.scanMemory` is enabled, the sync task SHALL, as one round-robin discovery entry, read a recency-ordered page of core memory entries (newest `updatedAt` first — using the existing `recall` tool with no query and a generous limit), classify each from its idler slice, and act on up to a small number of candidates per fire. A candidate SHALL be adopted as a work unit via `upsert_idea` — keyed by its existing stable id, with the same `getArchived` regression-enrichment as other sources — only when it is clearly actionable AND concerns an allowlisted repo; otherwise the sync SHALL mark it as not-idler-work rather than adopt it. The scan SHALL classify the whole recall page and THEN take its candidates (filter-then-take), so when the physically-newest entries are already triaged the scan still reaches older untriaged entries instead of starving them. The scan SHALL NOT introduce a new tool and SHALL NOT modify the core `recall` or `remember` tools.

#### Scenario: Actionable memory entry is adopted

- **GIVEN** `sources.scanMemory` is enabled and an untriaged memory entry keyed `sentry:1234` describes a fixable error in an allowlisted repo
- **WHEN** sync's memory-scan rotation runs
- **THEN** a work unit is created (or the existing entry adopted) via `upsert_idea` keyed by `sentry:1234`, enriched with any archived prior outcome

#### Scenario: Non-work memory entry is marked not-idler-work

- **GIVEN** an untriaged memory entry that is a user preference or note, not actionable work
- **WHEN** sync's memory-scan rotation runs
- **THEN** it is marked as not-idler-work and no work unit is created for it

#### Scenario: Out-of-allowlist entry is not adopted

- **GIVEN** an untriaged memory entry describing work in a repo not on the allowlist
- **WHEN** sync's memory-scan rotation runs
- **THEN** it is not adopted as an actionable unit

#### Scenario: Classify-then-take slides past triaged entries

- **GIVEN** the physically-newest memory entries in the recall page are all already idler-tracked or ignored-and-unchanged
- **WHEN** sync's memory-scan rotation runs
- **THEN** those entries are classified as non-candidates and older untriaged entries within the page are considered instead
