## ADDED Requirements

### Requirement: Off-hours channelless cron plugin

The system SHALL provide an `idler` plugin that registers channelless cron jobs firing only outside Clack's configured active hours. The plugin SHALL refuse to load (recording a reason via `sdk.error`) when the cron scheduler capability is unavailable, and SHALL be removable by deleting its folder and its `src/plugins/index.ts` registration with no other code referencing it. Configuration SHALL be validated with a zod schema and SHALL hot-reload on edit.

#### Scenario: Plugin loads only with cron capability

- **WHEN** the plugin initializes and `sdk.capabilities.crons` is false
- **THEN** it records a human-readable reason via `sdk.error` and returns without reconciling any cron jobs

#### Scenario: Jobs fire only outside active hours

- **GIVEN** the plugin is enabled with configured active (work) hours and timezone
- **WHEN** the current time is within active hours
- **THEN** none of the idler tasks execute work
- **AND** when the current time is outside active hours, the tasks are eligible to fire

#### Scenario: Plugin disabled or no allowlisted repos

- **GIVEN** the plugin's enabled flag is false OR no repository is allowlisted
- **WHEN** reconciliation runs
- **THEN** no idler cron specs are reconciled and no autonomous work occurs

#### Scenario: Config hot-reloads

- **GIVEN** an admin edits `data/plugins/idler/config.json`
- **WHEN** the change is saved
- **THEN** the plugin re-reconciles its cron specs without a code change

### Requirement: Three cooperating scheduled tasks

The plugin SHALL own three distinct cron specs — a **sync** task (hourly), a **work** task (every ~15 minutes), and a **summary** task (end of window) — each with its own prompt and `requiredTools`. The work task's `requiredTools` SHALL include the change-proposing and review tools; the sync and summary tasks SHALL NOT include change-proposing tools and SHALL NOT acquire a worktree.

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

#### Scenario: Summary task reports activity

- **WHEN** the summary task fires
- **THEN** it reads the activity log and posts a digest to the configured `reportingChannel`

### Requirement: Layered incremental sync

The sync task SHALL perform a cheap quick-fetch on every run — listing open Clack-authored pull requests (filtered by author login and/or branch prefix) and re-polling each tracked unit's references via their `howToRead` — and SHALL spread deeper discovery (channel scans, tracker polls) across runs rather than re-scanning every source every run.

#### Scenario: Quick-fetch every run

- **WHEN** the sync task fires
- **THEN** it lists open Clack PRs and refreshes their references' status
- **AND** advances per-reference cursors for any new activity

#### Scenario: Discovery is incremental

- **GIVEN** multiple configured discovery sources
- **WHEN** successive sync runs fire through the window
- **THEN** discovery is rotated across runs (round-robin over the configured sources) rather than re-scanning all sources on every run
- **AND** each configured source is discovered at least once per off-hours window

### Requirement: Four configurable work sources

The plugin SHALL support sourcing candidate work from: configured Slack channels (unhandled issues/requests, including bot-posted alert channels such as a Sentry `#sentry-alerts` channel), an external tracker via MCP (e.g. Asana tasks or Sentry issues), Clack's own open pull requests, and a free-form admin fetch-instruction document. The mapping from a source to a ledger reference's `howToRead`/`howToComment` recipe SHALL be driven by the fetch instructions, not hard-coded per source. When a channel source carries bot-posted alerts whose detail lives in attachments/blocks, the plugin SHALL extract the entity (e.g. the Sentry issue title + short-id/URL) — reading the message permalink via `fetch_slack_message` when the channel overview is insufficient — and key the unit by the entity's stable id.

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

### Requirement: Graceful degradation when a source MCP is absent

When a configured source's MCP tools are not installed, the plugin SHALL skip that source silently — no error surfaced, no unit created for it — leaving all other sources unaffected. Absence is detected by the referenced tool not being present in the session's available tools (equivalently, a tool-not-found result); the fetch instructions are never treated as a hard failure when a tool they name is missing.

#### Scenario: Missing tracker MCP is skipped

- **GIVEN** the fetch instructions reference an external tracker whose MCP is not installed
- **WHEN** sync runs
- **THEN** that source is skipped without error and other sources still produce units

### Requirement: Priority-ordered work-kind ladder

The work task SHALL select its single unit by priority, where the kind of work contributes to priority in the order: continue an in-flight PR, triage a candidate against the codebase, implement an approved unit, review an open PR, then nothing. Triage and review SHALL run in query mode (no worktree); implement and continue SHALL run in worker mode.

#### Scenario: Higher-priority kind preempts lower

- **GIVEN** both an in-flight PR with new comments and an untriaged candidate are workable
- **WHEN** the work task selects a unit
- **THEN** it selects the in-flight PR (continue) over the candidate (triage)

#### Scenario: Review is the lowest productive kind

- **GIVEN** no continue, triage, or implement work is available but an open PR can be reviewed
- **WHEN** the work task selects a unit
- **THEN** it performs a review pass rather than doing nothing

#### Scenario: Triage and review do not open a worktree

- **WHEN** the work task performs a triage or review step
- **THEN** it uses read/comment/review tools only and acquires no worktree

### Requirement: Continue processes human and Claude Code comments

The continue kind SHALL read NEW pull-request comments since the reference cursor — from both human reviewers and the Claude Code GitHub bot — address them in the worktree, push, advance the cursor, and resolve the corresponding review threads.

#### Scenario: New review comments addressed and threads resolved

- **GIVEN** a Clack PR has review comments newer than its reference cursor
- **WHEN** the continue kind runs on it
- **THEN** the comments (human and Claude Code) are addressed and pushed
- **AND** the corresponding review threads are resolved
- **AND** the cursor advances past the processed comments

#### Scenario: No new comments means no continue work

- **GIVEN** a Clack PR with no comments newer than its cursor
- **WHEN** the work task evaluates it
- **THEN** the continue kind has nothing to do on that unit this tick

### Requirement: @claude review trigger loop

The work task SHALL be able to (re)trigger external review by posting an `@claude review this` comment on a PR and then stopping, deferring the reading of any resulting comments to a later tick. The plugin SHALL NOT block waiting on the external bot.

#### Scenario: Trigger review then defer

- **GIVEN** the work task has just pushed changes to a PR
- **WHEN** it elects to request external review
- **THEN** it posts an `@claude review this` comment and ends the tick
- **AND** a later tick processes any resulting comments via the continue kind

#### Scenario: External bot absent is harmless

- **GIVEN** no external review bot is configured
- **WHEN** the trigger comment is posted
- **THEN** no error occurs and the unit waits at lowered priority until comments appear

### Requirement: Self-review feeds continue

When the review kind runs on Clack's own open PR and finds issues, it SHALL record them as the unit's `nextSteps` (and/or as a change-requesting review) so a later continue tick fixes them. Reviewing a human PR SHALL post a review and MAY approve.

#### Scenario: Self-review holes become next steps

- **GIVEN** the review kind runs on a Clack-authored PR and finds issues
- **WHEN** it completes
- **THEN** the issues are written into the unit's `nextSteps`
- **AND** a later continue tick addresses them

### Requirement: Never auto-merge

The idler SHALL NOT merge any pull request. It MAY triage, implement, continue, self-review, and post an approving or change-requesting review, but the merge action is reserved for a human.

#### Scenario: Approving review without merge

- **GIVEN** the idler reviews an open PR and finds it acceptable
- **WHEN** it acts on that PR
- **THEN** it MAY submit an approving review
- **AND** it MUST NOT merge the PR

### Requirement: Activity logging and summary digest

The plugin SHALL append every autonomous action (PR opened, comments addressed, review/approval posted, unit parked with reason, failure) to an activity log. The summary task SHALL read that log and post a digest including PRs opened, comments addressed, reviews/approvals, parked units with reasons, a ready-to-merge list, and failures.

#### Scenario: Actions are logged

- **WHEN** the work task takes an autonomous action
- **THEN** an entry describing it is appended to the activity log

#### Scenario: Summary digest covers the window

- **WHEN** the summary task fires
- **THEN** its digest reflects the logged actions for the window, including a ready-to-merge list

### Requirement: Two-layer instructions

The plugin SHALL ship behavior/contract instructions as topic-scoped content (the kind ladder, one-step-per-tick discipline, never-merge, the proof-required rule, ask-vs-proceed judgment, comment-writing guidance, and the activity-log contract), pre-attached to its task specs. It SHALL read sourcing/fetch instructions from an admin-editable file at `data/plugins/idler/fetch-instructions.md`. Editing the fetch instructions SHALL NOT alter the shipped behavior instructions.

#### Scenario: Behavior instructions are shipped and topic-scoped

- **WHEN** an idler task fires
- **THEN** the behavior/contract instructions are present in the session via the pre-attached topic

#### Scenario: Fetch instructions are admin-editable and hot-reload

- **GIVEN** an admin edits `data/plugins/idler/fetch-instructions.md`
- **WHEN** the next sync or work task fires
- **THEN** it uses the updated sourcing guidance without a code change

#### Scenario: Editing fetch instructions cannot change behavior

- **WHEN** the fetch-instruction file is edited
- **THEN** the shipped behavior/contract instructions are unchanged

### Requirement: Safety rails for autonomous operation

The plugin SHALL enforce a repository allowlist (only allowlisted repos may be acted upon), a per-fire action cap, and a per-night action cap. For cap purposes an **action** is a code-changing event (a `propose_change`/implement, a continue-push, or any push to a PR) — read-only triage and review/approval do NOT consume the cap. When the per-fire cap is reached the work task stops code-changing kinds for that fire; when the per-night cap is reached, further fires in the window skip code-changing kinds but MAY still triage/review. A worktree execution failure SHALL be recorded on the unit and sink its priority for retry on a later window rather than bricking the unit.

#### Scenario: Non-allowlisted repo is never touched

- **GIVEN** a candidate work unit targets a repository not in the allowlist
- **WHEN** the work task evaluates it
- **THEN** the unit is not implemented or continued

#### Scenario: Action caps bound autonomous work

- **GIVEN** the per-night action cap has been reached
- **WHEN** subsequent work fires occur in the same window
- **THEN** no further code-changing actions are taken until the next window
- **AND** the work task MAY still perform read-only triage/review steps

#### Scenario: Per-fire cap stops code changes mid-fire

- **GIVEN** the per-fire action cap is reached within a single work fire
- **WHEN** the work task would take another code-changing step
- **THEN** it stops and logs the cap as the reason for that fire

#### Scenario: Execution failure is recorded, not terminal

- **GIVEN** a worktree execution fails for a unit
- **WHEN** the failure is handled
- **THEN** the failure is recorded on the unit's `whereWeAre` and its priority sinks
- **AND** the unit remains open for retry on a later window
