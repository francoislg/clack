# changes-workflow Specification

## Purpose
TBD - created by archiving change add-dev-change-requests. Update Purpose after archive.
## Requirements
### Requirement: Changes Workflow Configuration

The system SHALL support a top-level configuration section for the change request workflow.

#### Scenario: Top-level workflow configuration
- **WHEN** `changesWorkflow` is configured at the root config level
- **THEN** it defines the global workflow behavior
- **AND** includes: `enabled`, `timeoutMinutes`, `additionalAllowedTools`, `sessionExpiryHours`, `monitoringIntervalMinutes`

#### Scenario: Disable workflow globally (default)
- **WHEN** `changesWorkflow` is not configured or `enabled` is `false`
- **THEN** all messages are treated as Q&A queries regardless of trigger settings
- **AND** no change execution occurs

#### Scenario: Per-trigger opt-in for direct messages
- **GIVEN** `changesWorkflow.enabled` is `true` at root level
- **WHEN** `directMessages.changesWorkflow.enabled` is `true`
- **THEN** the system enables change detection for DMs from dev users
- **AND** Claude uses semantic analysis to identify change requests vs questions

#### Scenario: Per-trigger opt-in for mentions
- **GIVEN** `changesWorkflow.enabled` is `true` at root level
- **WHEN** `mentions.changesWorkflow.enabled` is `true`
- **THEN** the system enables change detection for mentions from dev users
- **AND** Claude uses semantic analysis to identify change requests vs questions

#### Scenario: Per-trigger opt-in for reactions with custom trigger
- **GIVEN** `changesWorkflow.enabled` is `true` at root level
- **WHEN** `reactions.changesWorkflow.enabled` is `true`
- **THEN** the system listens for the `reactions.changesWorkflow.trigger` emoji
- **AND** processes the reacted message as a change request
- **AND** uses a different emoji than the Q&A trigger

#### Scenario: Reactions change trigger configuration
- **WHEN** `reactions.changesWorkflow.trigger` is configured
- **THEN** that emoji triggers change requests (e.g., "clack-work")
- **AND** the regular `reactions.trigger` emoji triggers Q&A queries

#### Scenario: Trigger disabled but workflow enabled
- **GIVEN** `changesWorkflow.enabled` is `true` at root level
- **AND** `directMessages.changesWorkflow.enabled` is `false` or not set
- **WHEN** a user sends a DM
- **THEN** all messages are treated as Q&A queries for that trigger type

#### Scenario: Execution timeout configuration
- **WHEN** `changesWorkflow.timeoutMinutes` is configured
- **THEN** the system uses that value as the maximum execution time
- **AND** defaults to 10 minutes if not specified

#### Scenario: Additional allowed tools
- **WHEN** `changesWorkflow.additionalAllowedTools` is configured as an array
- **THEN** those tools are added to the default allowed tools for change execution
- **AND** allows enabling tools like `WebFetch`, `WebSearch` for changes

#### Scenario: Session expiry configuration
- **WHEN** `changesWorkflow.sessionExpiryHours` is configured
- **THEN** idle sessions are cleaned up after that period
- **AND** defaults to 24 hours if not specified

#### Scenario: Monitoring interval configuration
- **WHEN** `changesWorkflow.monitoringIntervalMinutes` is configured
- **THEN** the completion monitor runs at that interval
- **AND** defaults to 15 minutes if not specified
- **AND** set to 0 to disable monitoring

#### Scenario: Reusable folders configuration block
- **WHEN** `changesWorkflow.reusableFolders` is configured
- **THEN** it accepts: `enabled` (bool), `minimumProvisioned` (int), `maxConcurrent` (int), `maxQueueDepth` (int), `idleReleaseHours` (int), `dirtyTrackedQuarantine` (bool)
- **AND** when `enabled` is `false` or absent, the disposable per-branch worktree model is used

### Requirement: Continue an Existing Pull Request

The Changes Workflow SHALL support continuing an existing pull request — advancing the work on its branch (e.g. addressing review comments, pushing follow-up commits) rather than only creating a fresh change. Continuation SHALL acquire the worker via the resume-from-remote-branch mode so a cold PR's commits are preserved, and SHALL reuse the existing worker-mode execution, push, and PR-update path. Continuation SHALL NOT merge the PR.

#### Scenario: Continue a warm PR branch

- **GIVEN** a PR whose worktree is still on a worker (`findByBranch` returns it)
- **WHEN** continuation is requested for that PR
- **THEN** the workflow resumes in that worktree and pushes follow-up commits to the same branch

#### Scenario: Continue a cold PR branch

- **GIVEN** a PR whose worktree was reclaimed (no warm worker has the branch)
- **WHEN** continuation is requested for that PR
- **THEN** the worker is acquired in resume-from-remote-branch mode (checked out from the PR's remote head)
- **AND** the PR's existing commits are preserved
- **AND** follow-up commits are pushed to the same branch

#### Scenario: Continuation never merges

- **WHEN** a continuation completes successfully
- **THEN** the PR is updated but not merged

#### Scenario: Continuation requests resume mode explicitly

- **GIVEN** the continue kind targets an existing PR
- **WHEN** it triggers the workflow
- **THEN** it explicitly requests the resume-from-remote-branch acquire mode (so a fresh-branch acquire cannot silently clobber the PR)

#### Scenario: Dirty branch on continuation routes through quarantine

- **GIVEN** the PR's worker has uncommitted modified-tracked files (e.g. from a prior failed run)
- **WHEN** continuation attempts to acquire/switch the branch
- **THEN** the existing dirty-tracked quarantine path applies (per `dirtyTrackedQuarantine`) rather than discarding the changes
- **AND** the unit records the quarantine as its blocker

### Requirement: Continuation Addresses Review Comments and Resolves Threads

When continuing a pull request, the workflow SHALL be able to incorporate the PR's outstanding review comments (from human reviewers and the Claude Code GitHub bot) into the worker-mode task, push the resulting changes, and resolve the addressed review threads.

#### Scenario: Comments incorporated and threads resolved on continuation

- **GIVEN** a PR with outstanding review comments
- **WHEN** continuation runs with those comments as context
- **THEN** the worker addresses them and pushes
- **AND** the addressed review threads are resolved

### Requirement: Autonomous Button-less Execution from a Scheduled Context

The Changes Workflow SHALL execute a staged change or continuation triggered from a scheduled (cron) context via `submit_response` with `auto: true`, without a Slack button click, when the actor's role passes the change-tool gate and `changesWorkflow.enabled` is set. Execution SHALL be awaited so the firing job remains in-flight (and is skipped by the scheduler's running-job guard) until the workflow completes, bounding concurrency to one change at a time per cron job (the running-job guard is keyed on the `CronJob` id).

#### Scenario: Auto-executed change from a cron fire

- **GIVEN** a scheduled fire whose actor passes the change-tool gate and `changesWorkflow.enabled` is true
- **WHEN** Claude calls `propose_change` then `submit_response` with `{ type: "change", ref, auto: true }`
- **THEN** the workflow executes immediately without a button click
- **AND** the firing job stays in-flight until the workflow completes

#### Scenario: Concurrent fire is skipped while a change runs

- **GIVEN** a scheduled change is still executing from a prior fire
- **WHEN** the next scheduled tick occurs for the same job
- **THEN** that tick is skipped by the running-job guard, so no second concurrent change starts

## REMOVED Requirements

### Requirement: PR instructions in config
**Reason**: Replaced by `{repo-name}/changes_instructions.md` convention-based files which follow the two-tier resolution chain and are editable via admin UI.
**Migration**: Move content from `pullRequestInstructions` (repo config field) or `changesWorkflow.prInstructions` (global config) into `data/default_configuration/{repo-name}_changes_instructions.md` or `data/configuration/{repo-name}_changes_instructions.md`.

### Requirement: Legacy XML-based plan generation
**Reason**: Replaced by the unified `processMessage` flow with MCP tool-based change proposals (`propose_change` + `auto: true`). The XML parsing path (`generateChangePlan`, `PLAN_GENERATION_PROMPT`, `<change-plan>` regex) is removed entirely.
**Migration**: No migration needed — the work-mode reaction emoji now routes through `processMessage` with the same tool pipeline as all other triggers.

### Requirement: Change Request Detection

The system SHALL detect change request intent via the `propose_change` MCP tool call. The tool SHALL enforce the `clack/{type}/{name}` naming convention when creating a NEW branch, but SHALL skip that convention check when continuing an EXISTING branch (`continue_existing_pr: true`), because the branch already exists and its name is a given. The disposable-model `createWorktree` backstop SHALL mirror this carve-out — skipping its convention check when acquiring in resume-from-remote-branch mode. Regardless of continuation, the tool SHALL refuse a change targeting a protected branch (the repository's default branch, `main`, or `master`).

#### Scenario: Claude-driven detection via tool
- **GIVEN** `changesWorkflow.enabled` is `true` AND the trigger's changes workflow is enabled
- **AND** the user has dev role (or higher)
- **WHEN** Claude determines the message is requesting code changes
- **THEN** Claude calls `propose_change` with branch, description, and repo
- **AND** the tool validates the input and returns a ref ID
- **AND** Claude includes a `change` action in `submit_response` referencing the ref

#### Scenario: Claude identifies question (no tool call)
- **GIVEN** change tools are available
- **WHEN** Claude determines the message is asking a question
- **THEN** Claude does NOT call `propose_change`
- **AND** Claude calls `submit_response` with an answer and standard Q&A actions

#### Scenario: Branch validation for a new branch
- **WHEN** Claude calls `propose_change` with a branch name and `continue_existing_pr` is absent or false
- **THEN** the tool validates the branch follows `clack/{type}/{name}` convention
- **AND** validates `type` is one of: fix, feat, refactor, docs, chore
- **AND** returns an error if validation fails, allowing Claude to retry

#### Scenario: Convention skipped when continuing an existing branch
- **WHEN** Claude calls `propose_change` with `continue_existing_pr: true`
- **THEN** the tool accepts the branch name without applying the `clack/{type}/{name}` convention check
- **AND** a branch name that does not match the convention (e.g. `feature/foo`) is accepted

#### Scenario: Relaxed name cannot create a junk branch
- **GIVEN** `propose_change` accepted a non-convention branch name under `continue_existing_pr: true`
- **WHEN** the worker is acquired in resume-from-remote-branch mode and the branch does not exist on the remote
- **THEN** acquisition fails with `RemoteBranchNotFound` rather than creating a new branch under that name

#### Scenario: Worktree-creation backstop honors continuation
- **WHEN** `createWorktree` is invoked with `resumeRemoteBranch` true
- **THEN** it does NOT reject the branch on the `clack/{type}/{name}` convention
- **AND** when `resumeRemoteBranch` is false it still refuses to create a worktree on a branch that does not follow the convention

#### Scenario: Protected branch refused even on continuation
- **WHEN** `propose_change` is called with `continue_existing_pr: true` and a protected branch name (the repo default, `main`, or `master`)
- **THEN** the tool returns an error and does not stage the change
- **AND** `createWorktree` likewise refuses to provision a worktree on a protected branch regardless of `resumeRemoteBranch`

#### Scenario: Repository validation in tool
- **WHEN** Claude calls `propose_change` with a repo name
- **THEN** the tool validates the repo exists in configuration and supports changes
- **AND** returns an error with the list of available repos if validation fails

#### Scenario: Existing worktree detection
- **GIVEN** a worktree already exists for the specified branch and repo
- **WHEN** Claude calls `propose_change`
- **THEN** the tool returns success with the ref ID plus existing worktree metadata (status, last activity)
- **AND** Claude can present a `choice` to the user: resume the existing session or start fresh

#### Scenario: Explicit change request via work-mode reaction
- **GIVEN** `changesWorkflow.enabled` is `true` AND `reactions.changesWorkflow.enabled` is `true`
- **WHEN** a dev+ user reacts with the work-mode emoji
- **THEN** the system processes the message through the standard `processMessage` pipeline with `workMode: true`
- **AND** Claude receives a prompt hint to use `propose_change` with `auto: true`
- **AND** the change is auto-executed without a button click

#### Scenario: Work-mode reaction from non-dev user
- **GIVEN** `reactions.changesWorkflow.enabled` is `true`
- **WHEN** a non-dev user reacts with the work-mode emoji
- **THEN** the system processes the message through the standard Q&A flow
- **AND** no change proposal tools are available (per existing role gating)

### Requirement: Change Request State Management

The system SHALL track active change execution as runtime state on the unified thread session.

#### Scenario: Track active changes via unified session

- **WHEN** a change request starts execution
- **THEN** the system populates `activeChange` on the existing thread session with: branch, repo, description, worktree, status, start time
- **AND** the session's in-memory thread index already maps the thread to this session

#### Scenario: Prevent duplicate requests only during active execution

- **GIVEN** a user has a session with `activeChange` in an actively-executing state (`executing`, `reviewing`, `merging`)
- **WHEN** they send another change request (outside the existing thread)
- **THEN** the system responds that they have a pending request
- **AND** provides a link to the existing thread

#### Scenario: Allow new changes when existing session is idle

- **GIVEN** a user has a session with `activeChange` in `pr_created` state
- **WHEN** they send a new change request in a different thread
- **THEN** the system allows the new change to proceed
- **AND** the existing session's `activeChange` remains available for context

### Requirement: Change Request Feedback

The system SHALL provide feedback throughout the change request lifecycle.

#### Scenario: Acknowledge change request
- **WHEN** a change action is approved by the user (button click) or auto-executed
- **THEN** the system immediately replies with a status message
- **AND** resolves the staged intent to get branch, description, and repo
- **AND** starts the change workflow

#### Scenario: Initial progress message
- **WHEN** the change workflow starts (before Claude begins executing)
- **THEN** the orchestrator posts one initial status message to the thread (e.g., "Setting up workspace...")
- **AND** after Claude starts, Claude owns all further communication via the `report_status` tool

#### Scenario: Success determined from session state
- **GIVEN** Claude has finished executing
- **WHEN** the orchestrator reads the session state
- **AND** the session has a `prUrl` and status `pr_created`
- **THEN** the workflow returns success with the PR URL

#### Scenario: Failure determined from session state
- **GIVEN** Claude has finished executing
- **WHEN** the orchestrator reads the session state
- **AND** the session does NOT have a `prUrl`
- **THEN** the workflow returns failure
- **AND** the worktree is preserved for recovery

### Requirement: Thread Follow-up Commands

The system SHALL support follow-up actions in threads via Claude's intent analysis, not via state-gated tool availability. Claude receives active change context (if any) as prompt context and decides what to do based on the user's message.

#### Scenario: Follow-up on active change via context

- **GIVEN** a thread's session has `activeChange` with a branch and optional PR URL
- **WHEN** a user replies in that thread
- **THEN** Claude receives the active change details as prompt context (branch, repo, status, PR URL)
- **AND** Claude determines the user's intent from the message content
- **AND** Claude uses the appropriate tools (Clack tools, GitHub MCP, or both) to fulfill the request

#### Scenario: Follow-up after change execution cleared

- **GIVEN** a thread previously had an active change that has since been cleared (PR merged/closed)
- **WHEN** a user replies in that thread
- **THEN** Claude reads the thread context from Slack which contains the PR URL and outcome
- **AND** Claude can answer questions about the change, propose a new one, or act on the PR via GitHub MCP

#### Scenario: Action on unrelated PR in active change thread

- **GIVEN** a thread has an active change on branch X with PR #123
- **WHEN** the user asks Claude to act on a different PR (e.g., "comment on PR #456 on repo Y")
- **THEN** Claude identifies the target as PR #456 on repo Y, not the active change's PR
- **AND** Claude uses GitHub MCP tools to fulfill the request
- **AND** the active change context is unaffected

#### Scenario: Review command execution

- **GIVEN** an update that involves reviewing PR feedback is requested
- **WHEN** the orchestrator starts the review flow
- **THEN** it fetches PR comments and reviews via the GitHub API
- **AND** builds a review prompt with the fetched feedback
- **AND** runs Claude with `review` mode tools (`git_push`, `report_status`)
- **AND** Claude implements review feedback, commits, and pushes via `git_push` tool
- **AND** Claude reports results via `report_status` tool

#### Scenario: Merge command execution

- **GIVEN** a merge action is approved
- **WHEN** the orchestrator starts the merge flow
- **THEN** it runs Claude with `merge` mode tools (`merge_pr`, `report_status`)
- **AND** Claude calls `merge_pr` which handles the merge, branch cleanup, and clearing `activeChange` from the session
- **AND** Claude reports the result via `report_status`

#### Scenario: Update command execution

- **GIVEN** an update action is approved
- **WHEN** the orchestrator starts the update flow
- **THEN** it runs Claude with `update` mode tools (`git_push`, `report_status`) plus standard code tools
- **AND** Claude implements the requested changes, commits, and pushes via `git_push`
- **AND** Claude reports results via `report_status`

#### Scenario: Close command execution

- **GIVEN** a close action is approved
- **WHEN** the orchestrator starts the close flow
- **THEN** it runs Claude with `close` mode tools (`close_pr`, `report_status`)
- **AND** Claude calls `close_pr` which handles closing, optional branch deletion, and clearing `activeChange` from the session
- **AND** Claude reports the result via `report_status`

#### Scenario: Follow-up as question

- **GIVEN** a thread with or without active change execution
- **WHEN** Claude determines the message is a question (not an action request)
- **THEN** Claude responds with a standard Q&A answer via `submit_response`

### Requirement: PR Operations via GitHub API

The system SHALL perform all PR operations through the GitHub API using Octokit.

#### Scenario: Ensure PR via API (idempotent create)
- **GIVEN** changes have been committed and pushed to a branch
- **WHEN** a PR needs to be created
- **THEN** the system first checks for an existing open PR on the branch using `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open`
- **AND** if an open PR exists, returns the existing PR URL without creating a duplicate
- **AND** if no open PR exists, creates a new PR using `POST /repos/{owner}/{repo}/pulls`
- **AND** sets the title, body, base branch, and head branch
- **AND** returns the PR URL on success

#### Scenario: Merge PR via API
- **GIVEN** a PR is open and ready to merge
- **WHEN** a merge is requested
- **THEN** the system uses Octokit to merge the PR (`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`)
- **AND** uses the configured merge strategy (squash, merge, or rebase)

#### Scenario: Close PR via API
- **GIVEN** a PR is open
- **WHEN** a close is requested
- **THEN** the system uses Octokit to close the PR (`PATCH /repos/{owner}/{repo}/pulls/{pull_number}`)
- **AND** sets the state to `closed`

#### Scenario: Get PR status via API
- **GIVEN** a PR URL exists in the session
- **WHEN** the system checks PR status
- **THEN** it uses Octokit to fetch the PR state (`GET /repos/{owner}/{repo}/pulls/{pull_number}`)
- **AND** returns `OPEN`, `MERGED`, or `CLOSED`

#### Scenario: Fetch PR review comments via API
- **GIVEN** a review command is triggered
- **WHEN** the system fetches PR feedback
- **THEN** it uses Octokit to get comments and reviews
- **AND** passes the feedback to Claude for implementation

#### Scenario: Delete remote branch via API
- **GIVEN** a PR has been merged or closed
- **WHEN** branch deletion is requested
- **THEN** the system uses Octokit to delete the branch (`DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}`)

#### Scenario: Push via git with token authentication
- **GIVEN** changes need to be pushed to a remote branch
- **WHEN** a push operation is needed
- **THEN** the system configures the remote URL with a fresh installation token
- **AND** uses `simple-git` to push over HTTPS

### Requirement: Worker Visibility

The system SHALL provide real-time visibility into change execution progress.

#### Scenario: Session state persistence
- **WHEN** a change session is created
- **THEN** the system creates `data/worktree-sessions/{branch-name}/state.json`
- **AND** the state includes: sessionId, status, phase, branch, repo, userId, description, prUrl, startedAt, lastActivityAt, lastMessage, channel, threadTs, cancelledBy

#### Scenario: State updates during execution
- **WHEN** the session status changes (planning → executing → pr_created → etc., or cancelled from any active state)
- **THEN** the system updates `state.json` with new status and phase
- **AND** updates `lastActivityAt` timestamp

#### Scenario: Execution logging
- **WHEN** Claude produces output during change execution
- **THEN** the system appends to `data/worktree-sessions/{branch-name}/execution.log`
- **AND** each log entry includes a timestamp in ISO format

#### Scenario: Session folder cleanup on success
- **GIVEN** a change session completes successfully (merged or closed)
- **WHEN** the session is removed
- **THEN** the session folder is deleted from `data/worktree-sessions/`

#### Scenario: Session folder preserved on failure or cancellation
- **GIVEN** a change session fails or is cancelled
- **WHEN** cleanup runs
- **THEN** the session folder is NOT deleted
- **AND** the folder is preserved indefinitely for debugging
- **AND** manual deletion is required to remove it

#### Scenario: Active workers display
- **GIVEN** a user with dev role views the Home tab
- **WHEN** there are active change sessions
- **THEN** the Home tab shows a "Active Workers" section
- **AND** each worker shows: status, description, branch, repo, user, and PR link (if available)
- **AND** cancelled workers display with a distinct emoji and "Cancelled" label

#### Scenario: Cancellation metadata persisted
- **WHEN** a worker execution is cancelled
- **THEN** `state.json` includes `cancelledBy: { userId, reason? }`
- **AND** `execution.log` records "Cancelled by <userId>: <reason>"
- **AND** status is set to `"cancelled"` (distinct from `"failed"`)

### Requirement: Cancelled Change Status

The system SHALL support `"cancelled"` as a terminal `ChangeStatus` distinct from `"failed"`.

#### Scenario: Cancelled is terminal for blocking purposes
- **WHEN** a change has status `"cancelled"`
- **THEN** it does not block new change requests from the same user
- **AND** it is skipped during session restoration on startup
- **AND** the worktree and session folder are preserved (not cleaned up) so the user can resume by requesting the same change again

#### Scenario: Phase mapping
- **WHEN** `statusToPhase` is called with `"cancelled"`
- **THEN** it returns `"Cancelled"`

#### Scenario: Workflow sets cancelled status
- **WHEN** a worker execution returns after being aborted
- **AND** `activeChange.cancelledBy` is set
- **THEN** `workflow.ts` sets the status to `"cancelled"` (not `"failed"`)
- **AND** returns `ChangeResult` with `cancelled: true` and `cancelledBy` info

#### Scenario: ChangeResult carries cancellation info
- **WHEN** a cancelled `ChangeResult` is returned
- **THEN** it includes `cancelled: true` and `cancelledBy: { userId, reason? }`
- **AND** the calling handler uses this to format the Slack message

#### Scenario: Cancellation during follow-up sets cancelled status
- **GIVEN** a change has status `pr_created` and a follow-up command (review, update, merge) is executing
- **WHEN** the follow-up execution is cancelled
- **THEN** the change status is set to `"cancelled"` regardless of prior status
- **AND** the PR remains on GitHub in its current state
- **AND** the user can request a new follow-up action in the same thread later

### Requirement: Worker Pool Mediation

The system SHALL route worktree acquisition and release through `WorkerPool` when `changesWorkflow.reusableFolders.enabled` is `true`.

#### Scenario: Acquire via pool on change start
- **GIVEN** `reusableFolders.enabled` is `true`
- **WHEN** `startChangeWorkflow` reaches the worktree-acquisition step
- **THEN** it calls `pool.acquire(repo, branch, sessionId)` instead of `createWorktree`
- **AND** the returned `Worker.worktreePath` is recorded on `activeChange.worktree`

#### Scenario: Release via pool on PR completion
- **GIVEN** `reusableFolders.enabled` is `true`
- **WHEN** the completion monitor detects a PR was merged or closed externally
- **THEN** it calls `pool.release(worker, "pr_merged" | "pr_closed")` instead of `removeWorktree`

#### Scenario: Release via pool on follow-up merge or close
- **GIVEN** `reusableFolders.enabled` is `true`
- **WHEN** the merge or close follow-up command completes successfully
- **THEN** the workflow calls `pool.release(worker, "pr_merged" | "pr_closed")` for the active worker

#### Scenario: Disposable mode behaves as before
- **GIVEN** `reusableFolders.enabled` is `false` or unset
- **WHEN** the workflow runs any change
- **THEN** behavior matches the pre-change disposable model exactly
- **AND** no pool state is read or written

### Requirement: Detached Session Re-Acquire

The system SHALL support follow-up commands on sessions whose worker was detached during idle release.

#### Scenario: Re-acquire on follow-up
- **GIVEN** a session's `activeChange.worktree` is marked detached (post idle-release)
- **WHEN** any follow-up command (`review`, `update`, `merge`, `close`) executes
- **THEN** the workflow calls `pool.acquire(repo, branch, sessionId)`
- **AND** the returned worker is used for the command

#### Scenario: Re-acquire when pool is saturated
- **GIVEN** a detached session triggers a follow-up
- **AND** the pool is at `maxConcurrent` with no idle workers
- **WHEN** acquire is called
- **THEN** the request enqueues per the pool's queue rules
- **AND** the user is notified that the action is queued

### Requirement: Queue Acknowledgment

The system SHALL inform the user when a change request is enqueued.

#### Scenario: Initial Slack ack on queue
- **WHEN** a change request is enqueued by the pool
- **THEN** the orchestrator posts a status message indicating the request is queued and its position
- **AND** a follow-up status is posted when the request is dequeued and execution begins

#### Scenario: Pool-exhausted message
- **WHEN** the pool rejects with `PoolExhausted`
- **THEN** the orchestrator returns `{ success: false, error: <message indicating capacity is full> }`
- **AND** the Slack response surfaces the error to the user

### Requirement: Worker Visibility

The system SHALL provide real-time visibility into change execution progress, including pool state when reusable folders are enabled.

#### Scenario: Pool state visible when reusable folders enabled
- **GIVEN** `reusableFolders.enabled` is `true` and the viewer is admin or owner
- **WHEN** the Home Tab renders
- **THEN** a "Worker Pool" section is shown listing per-repo slot counts (idle, busy, initializing, quarantined) and queue depth
- **AND** the disposable-mode Active Workers section is hidden when the pool is enabled

## ADDED Requirements

### Requirement: Localized Bot-Authored Change Workflow Messages

All user-visible messages posted to Slack by change-workflow code itself (not by Claude through `report_status` or `submit_response`) SHALL be sourced from the localization dictionary via the `t()` helper. This includes:

- The initial "Setting up workspace…" status message posted before Claude begins executing.
- Cancellation confirmations (e.g. "Cancelled by user").
- Quarantine notifications sent to the worker's owner via DM (the bot-authored framing of the message; the quarantined-file list passes through verbatim).
- "PR merged externally" / "PR closed externally" notifications posted by the background monitor.
- "Active Workers" Home Tab section labels (status, "Cancelled" label, paused/one-time indicators).
- Idle-release / setup-version-mismatch admin notifications.

Dynamic values (branch name, repo name, PR URL, user mention, ISO timestamps, the description the user originally provided) SHALL pass through verbatim.

#### Scenario: Initial workspace setup message localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a change workflow starts and the orchestrator posts the initial status message
- **THEN** the message text is in French via `t()`

#### Scenario: Cancellation confirmation localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a worker is cancelled and the cancellation confirmation is posted
- **THEN** the bot-authored framing (e.g. "Cancelled by") is in French via `t()`
- **AND** the canceller's user mention `<@U…>` passes through verbatim

#### Scenario: External-merge / external-close notifications localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** the background monitor detects an externally merged or closed PR and posts a notification to the original thread
- **THEN** the bot-authored notification text is in French via `t()`
- **AND** the PR URL and branch name pass through verbatim

#### Scenario: Quarantine DM localized

- **GIVEN** the configured language is `"fr"` AND the reusable-worker pool is enabled
- **WHEN** a worker is quarantined and the owner receives a DM
- **THEN** the bot-authored framing of the DM is in French via `t()`
- **AND** the quarantined file list passes through verbatim

#### Scenario: Active Workers Home Tab labels localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** the Home Tab renders the Active Workers section
- **THEN** the section header, status labels, and "Cancelled" indicator are in French via `t()`
- **AND** the branch, repo, user mention, description, and PR URL pass through verbatim

### Requirement: Claude-Authored Change Workflow Narration Honors Language Directive

Text produced by Claude within the change workflow — including `report_status` messages, PR-description content (within Clack's control rather than the user's literal template), commit messages, and any `submit_response` text — SHALL be produced in the configured language because the system prompt path used by change-workflow Claude invocations contains the language directive.

PR templates loaded from `data/default_configuration/{repo}/changes_instructions.md` or repo overrides are operator-authored and are NOT translated by the system; whether their content is in the configured language is the operator's responsibility.

#### Scenario: report_status messages produced in configured language

- **GIVEN** the configured language is `"fr"`
- **WHEN** Claude calls `report_status` during change execution
- **THEN** the message text Claude provides is written in French (via the language directive)
- **AND** the bot posts the message verbatim, without further translation

#### Scenario: PR description content produced in configured language where Claude is the author

- **GIVEN** the configured language is `"fr"`
- **WHEN** Claude composes PR description content for `ensure_pr`
- **THEN** the prose Claude writes is in French (via the language directive)
- **AND** code blocks, file paths, identifiers, and quoted technical terms pass through in their original form

#### Scenario: Operator-supplied PR template passes through unchanged

- **GIVEN** the configured language is `"fr"` AND `{repo}/changes_instructions.md` contains an English PR template
- **WHEN** the template is loaded and presented to Claude
- **THEN** the template is NOT translated by the system
- **AND** the operator is responsible for translating the template if they want a fully French output

### Requirement: Changes Workflow availability by context visibility

Beyond the per-trigger opt-in for mentions/DMs/reactions, the system SHALL make the Changes Workflow available on the `threadReply`, `autoRespond`, and `scheduled` triggers when global `changesWorkflow.enabled` is `true` AND the context is **visible** AND the acting user has change permission (`canRequestChanges(role)` — dev or higher).

A context is **invisible** when it is a channelless cron dispatch (a synthetic `channelless:<jobId>` channel with no bound Slack channel, per `src/channelless.ts`). In an invisible context the Changes Workflow SHALL be unavailable, and `auto`-execution of change / config / update / skill intents SHALL be suppressed. Channelless `post_to` auto-delivery is unaffected (channelless dispatch depends on it). All other contexts (mentions, DMs, reactions, thread replies, auto-respond replies, and channel-bound scheduled runs) are visible.

For `threadReply`, availability is determined by the replying user's role and the visibility/global rules only — independent of who started the thread or the thread's original trigger type. Thread replies, auto-respond, and scheduled triggers have no per-trigger `changesWorkflow.enabled` config block, so none is consulted for them.

#### Scenario: Dev replies in a visible thread
- **GIVEN** `changesWorkflow.enabled` is `true` and the context is visible (a real Slack channel)
- **AND** a user with role dev (or higher) replies in an existing thread without @mentioning the bot
- **WHEN** the reply is processed as a `threadReply` trigger
- **THEN** the Changes Workflow tools (`propose_change`, `request_update`, `cancel_worker_run`) are available
- **AND** an unambiguous "do it" directive stages the change with `auto: true` so it executes without a second click

#### Scenario: Non-dev starts the thread, a dev replies "do it"
- **GIVEN** `changesWorkflow.enabled` is `true` and the context is visible
- **AND** a thread was started by a non-dev user
- **WHEN** a dev (or higher) replies in that thread with a clear directive
- **THEN** availability is based on the replying dev's role, not the thread starter's, and the change can be staged and launched

#### Scenario: Auto-respond and channel-bound scheduled are visible
- **GIVEN** `changesWorkflow.enabled` is `true`
- **WHEN** a turn is processed as `autoRespond`, or as `scheduled` bound to a real Slack channel
- **THEN** the Changes Workflow is available to a dev+ acting user (these are visible contexts)

#### Scenario: Channelless cron dispatch is an invisible context
- **GIVEN** a `scheduled` trigger dispatched to a channelless sentinel (`channelless:<jobId>`)
- **WHEN** the turn runs
- **THEN** the Changes Workflow tools are NOT available
- **AND** `auto`-execution of any staged change / config / update / skill intent is suppressed
- **AND** `post_to` auto-delivery still functions

#### Scenario: Member acting in a visible context
- **GIVEN** `changesWorkflow.enabled` is `true` and the context is visible
- **WHEN** a user with role member asks for a code change
- **THEN** the Changes Workflow tools are NOT available
- **AND** the bot explains that a dev is needed rather than reporting a tooling outage

#### Scenario: Workflow disabled globally
- **GIVEN** `changesWorkflow.enabled` is `false` or not configured
- **WHEN** any user acts in any context
- **THEN** the Changes Workflow is unavailable and the turn is treated as a Q&A query

### Requirement: Active-Change Waiting Marker

The system SHALL record a mode-neutral "waiting for execution capacity" marker on the active-change runtime state, driven by the worker pool's existing `onQueued` acquire seam. The marker SHALL be set when an acquire enqueues and cleared when a worker is handed out, so consumers (e.g. `find_changes`) can distinguish a parked change from an actively-running one without consulting pool internals. Because the marker is driven solely by `onQueued` — which the disposable pool never fires — a model that does not enqueue acquires SHALL leave the marker unset (the abstraction degenerates rather than branching on pool model).

#### Scenario: Marker set when acquire enqueues
- **WHEN** a change request's `acquire` enqueues and the pool invokes `onQueued`
- **THEN** the system records a waiting marker on that change's active runtime state

#### Scenario: Marker cleared when worker acquired
- **WHEN** the enqueued `acquire` resolves and a worker is handed to the change
- **THEN** the system clears the waiting marker before execution proceeds

#### Scenario: Marker never set in non-enqueueing model
- **GIVEN** a worker pool that hands out a worker immediately without enqueuing (disposable pool)
- **WHEN** a change request acquires a worker
- **THEN** `onQueued` is not invoked and the waiting marker is never set

### Requirement: Active-Change Freshness Exposure

The active-change runtime snapshot consumed by query tools SHALL expose `lastActivityAt` (the timestamp of the most recent status or PR-URL update) alongside the existing `startedAt`, so freshness can be derived without changing how active changes are tracked.

#### Scenario: Snapshot includes last-activity timestamp
- **WHEN** the active-change snapshot is produced for an in-flight change
- **THEN** it includes `lastActivityAt` reflecting the most recent status/PR update
- **AND** it continues to include the existing `startedAt`

