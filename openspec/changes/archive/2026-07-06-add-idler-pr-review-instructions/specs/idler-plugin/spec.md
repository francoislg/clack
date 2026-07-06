# Delta — idler-plugin

## ADDED Requirements

### Requirement: Canonical PR review check

The shipped behavior contract SHALL define a canonical PR-handling sequence that both the sync and work tasks apply to every reference pointing at a pull request, overriding the unit's free-text `howToRead` recipe for that reference (the recipe continues to govern non-PR surfaces). The sequence SHALL be: (a) attach the `github` integration via `attach_integration("github")`; (b) probe each PR with `pull_request_read` method `get_reviews` and compare the latest review's timestamp against the reference cursor — a review strictly newer than the cursor is a hit, at-or-before is not; (c) on a hit, read the full review content via `pull_request_read` methods `get_comments` (review summary bodies) AND `get_review_comments` (inline threads) — never relying on `get_reviews` alone, which returns metadata without body text; (d) record the outcome via `upsert_idea` with `freshInput: true` (kind `continue`) so the unit rises to the top of the work ladder. The contract SHALL live in the shipped behavior topic (not the admin-editable fetch instructions), and the sync and work prompts SHALL each point at it where references are read.

#### Scenario: New review on a tracked Clack PR is detected and prioritized

- **GIVEN** a tracked unit references an open Clack PR that received a formal review newer than the reference cursor
- **WHEN** the sync fire re-polls the unit's references
- **THEN** the canonical check probes reviews via `pull_request_read` `get_reviews`, reads content via `get_comments` and `get_review_comments`
- **AND** the unit is updated with `freshInput: true` so it outranks all other workable units

#### Scenario: Contract overrides a blind recipe

- **GIVEN** a tracked unit whose `howToRead` recipe predates the contract and never mentions review tools
- **WHEN** either the sync or work fire reads that unit's PR reference
- **THEN** the canonical review check runs anyway
- **AND** no recipe migration or repair is required

#### Scenario: Already-seen review does not re-fire

- **GIVEN** a tracked unit whose PR's latest review is at or before the reference cursor
- **WHEN** the canonical check probes it
- **THEN** no `freshInput` is set and no content read is performed for that PR

#### Scenario: Work fire re-read applies the same contract

- **GIVEN** the work fire is re-reading a selected unit's references before committing to it
- **WHEN** a reference points at a PR
- **THEN** the canonical review check is applied, not the recipe text alone

### Requirement: Gated GitHub integration attach

The idler SHALL attach the `github` integration only when PR references are in play — i.e. when any tracked unit carries a PR reference OR the quick-fetch lists open Clack-authored pull requests. Fires with no PR references in play SHALL NOT attach the integration and SHALL incur no added cost from the canonical check.

#### Scenario: Quiet fire skips the attach

- **GIVEN** no tracked unit references a PR and no open Clack-authored PRs exist
- **WHEN** a sync or work fire runs
- **THEN** `attach_integration("github")` is not called and no review probes are made

#### Scenario: Open Clack PRs trigger the attach

- **GIVEN** the quick-fetch lists at least one open Clack-authored PR
- **WHEN** the sync fire's maintenance pass runs
- **THEN** the `github` integration is attached before the per-PR review probes

## MODIFIED Requirements

### Requirement: Configurable work sources

The plugin SHALL support sourcing candidate work from: configured Slack channels (unhandled issues/requests, including bot-posted alert channels such as a Sentry `#sentry-alerts` channel), an external tracker via MCP (e.g. Asana tasks or Sentry issues), Clack's own open pull requests, recently-updated core memory entries (gated by `sources.scanMemory`, default `true`), and a free-form admin fetch-instruction document. The mapping from a source to a ledger reference's `howToRead`/`howToComment` recipe SHALL be driven by the fetch instructions, not hard-coded per source — with ONE exception: for references that point at a pull request, review detection SHALL follow the shipped behavior contract's canonical PR review check (see "Canonical PR review check"), which takes precedence over the recipe text; the recipe continues to drive reading/commenting for non-PR surfaces and for PR concerns other than review detection. When a channel source carries bot-posted alerts whose detail lives in attachments/blocks, the plugin SHALL extract the entity (e.g. the Sentry issue title + short-id/URL) — reading the message permalink via `fetch_slack_message` when the channel overview is insufficient — and key the unit by the entity's stable id. The `sources.scanMemory` flag SHALL default to `true`, and a persisted `sources` object lacking the field SHALL be read as `true`.

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

#### Scenario: PR-reference review detection is contract-driven, not recipe-driven

- **GIVEN** a unit whose reference points at a pull request, with any `howToRead` recipe text
- **WHEN** a sync or work fire reads that reference
- **THEN** review detection follows the canonical PR review check from the shipped behavior contract
- **AND** the recipe still governs the unit's non-PR surfaces and non-review PR concerns
