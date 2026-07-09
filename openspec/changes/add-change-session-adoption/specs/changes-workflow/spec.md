# changes-workflow Delta

## ADDED Requirements

### Requirement: Change Session Adoption

When a continuation (`continue_existing_pr`) targets a branch whose change session is alive under ANOTHER conversation's sessionId, the workflow SHALL re-home that session into the requesting conversation instead of creating a new change session — preserving the `activeChange` (status, `prUrl`, `sdkSessionId`, verification counters), rebinding the session ref (channel/threadTs/user), and reassigning the worker claim when a worker currently holds the branch. Exactly one session SHALL reference a branch at any time. Adoption SHALL be refused while the owning session is live (a run handle is set, its status is actively-executing — `executing`/`reviewing`/`merging` — or it is parked in the acquire queue) and SHALL be permitted only to the change's owning user or an admin+.

#### Scenario: Continue a channel-thread change from a DM

- **GIVEN** user U created a change in channel thread A that reached `pr_created`, with no run executing
- **WHEN** U asks to continue that PR in a DM and the staged continuation executes
- **THEN** the existing change session is re-homed to the DM conversation (same `activeChange` object — status, `prUrl`, `sdkSessionId`, verification counters)
- **AND** the worker's claim (if a worker holds the branch) is reassigned to the DM sessionId without any release, branch switch, or install step
- **AND** the continuation executes as a follow-up that resumes the adopted `sdkSessionId`, so the worker Claude retains its conversational context

#### Scenario: Adoption survives a restart

- **GIVEN** a change session was adopted into a DM
- **WHEN** the process restarts and change sessions are restored
- **THEN** the restored session is bound to the DM conversation (the branch-keyed persisted session was rewritten with the new channel/threadTs on its next state write)

#### Scenario: Live session refuses adoption

- **GIVEN** the owning session has a live run handle, an actively-executing status, or is queued for a worker
- **WHEN** another conversation attempts to continue the branch
- **THEN** adoption is refused without mutating any state
- **AND** the user-facing message names the claiming conversation (channel from the session ref), with a generic fallback when the ref is unavailable

#### Scenario: Adoption is owner-or-admin gated

- **GIVEN** the change session's owning user is U1
- **WHEN** user U2 (dev, not admin) attempts to continue the branch from their own conversation
- **THEN** adoption is refused and the refusal names the owner
- **AND** an admin+ user is permitted to adopt

#### Scenario: Old conversation answers with a tombstone

- **GIVEN** a change session was adopted away from thread A
- **WHEN** a change action button is clicked in thread A
- **THEN** the reply says the change moved to the new conversation (naming the channel) instead of a generic no-active-change error
- **AND** after a process restart the tombstone is gone and the click degrades to the existing no-active-change message

#### Scenario: Adopted failed change keeps its recovery ladder

- **GIVEN** the owning session's change status is `failed` with no live handle
- **WHEN** it is adopted into another conversation
- **THEN** the adopted session carries the `failed` status and `verificationAttempts`, and the recovery actions (Continue / Start over / Discard) work from the new conversation

#### Scenario: Adopted cold change re-acquires preserving PR commits

- **GIVEN** an adopted change whose worker was idle-released (no worker holds the branch)
- **WHEN** the continuation follow-up re-acquires a worker
- **THEN** the acquire uses resume-from-remote-branch mode, so the PR's pushed commits are preserved

### Requirement: Orphaned Claim Fallback

When acquiring a worker collides with a busy worker whose `claimedBy` sessionId has NO `activeChange` (the owning session expired or was not restored), the workflow SHALL detach the stale claim via the idle sweep's clean-detach mechanics and retry the acquire exactly once, instead of failing. Because adoption handles every case where the owning session still exists, this fallback applies only to orphans; a second collision after the retry SHALL surface as the live-claim refusal, never a loop.

#### Scenario: Orphaned claim is detached and the acquire retried

- **GIVEN** a busy worker holds branch `B` and its `claimedBy` sessionId has no `activeChange`
- **WHEN** a continuation or change acquires branch `B` and hits the "already in flight" collision
- **THEN** the workflow detaches the worker via the clean-detach path with unpushed commits treated as dirty (no session state exists to prove they are safe)
- **AND** retries the acquire once, which claims the worker for the requesting session

#### Scenario: Dirty orphan quarantines instead of releasing

- **GIVEN** an orphaned claim whose worker has modified tracked files (or unpushed commits)
- **WHEN** the fallback attempts the clean detach
- **THEN** the worker is quarantined per the existing dirty-quarantine path (owner DM, Home-Tab restore)
- **AND** the acquiring change fails with the quarantine explanation rather than retrying

#### Scenario: Fallback never loops

- **GIVEN** the fallback detached an orphaned claim
- **WHEN** the retried acquire collides again (another session claimed the branch in the interim)
- **THEN** the second collision surfaces as the live-claim refusal with no further retry

## MODIFIED Requirements

### Requirement: Continue an Existing Pull Request

The Changes Workflow SHALL support continuing an existing pull request — advancing the work on its branch (e.g. addressing review comments, pushing follow-up commits) rather than only creating a fresh change. When the branch's change session is alive in another conversation, continuation SHALL proceed via Change Session Adoption (re-homing the session) rather than creating a parallel session. When no session exists, continuation SHALL acquire the worker via the resume-from-remote-branch mode so a cold PR's commits are preserved, and SHALL reuse the existing worker-mode execution, push, and PR-update path. Continuation SHALL NOT merge the PR.

#### Scenario: Continue a warm PR branch

- **GIVEN** a PR whose worktree is still on a worker (`findByBranch` returns it) and whose session belongs to the requesting conversation
- **WHEN** continuation is requested for that PR
- **THEN** the workflow resumes in that worktree and pushes follow-up commits to the same branch

#### Scenario: Continue a cold PR branch

- **GIVEN** a PR whose worktree was reclaimed (no warm worker has the branch) and no change session exists for it
- **WHEN** continuation is requested for that PR
- **THEN** the worker is acquired in resume-from-remote-branch mode (checked out from the PR's remote head)
- **AND** the PR's existing commits are preserved
- **AND** follow-up commits are pushed to the same branch

#### Scenario: Continue a PR owned by another conversation

- **GIVEN** a PR whose change session is alive under another conversation's sessionId and not live
- **WHEN** continuation is requested for that PR from the current conversation
- **THEN** the session is adopted per the Change Session Adoption requirement and the continuation executes as a follow-up on it

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

#### Scenario: Detached follow-up re-acquire preserves PR commits

- **GIVEN** a change session with a PR (`prUrl` set or status `pr_created`) whose worktree binding was detached (e.g. by the idle sweep)
- **WHEN** a follow-up command re-acquires a worker
- **THEN** the acquire uses resume-from-remote-branch mode so the branch is checked out from its own remote head, not rebuilt from the default branch
- **AND** a remotely-deleted branch surfaces as a follow-up error rather than silently rebasing from the default branch

### Requirement: Change Request Detection

The system SHALL detect change request intent via the `propose_change` MCP tool call. The tool SHALL enforce the `clack/{type}/{name}` naming convention when creating a NEW branch, but SHALL skip that convention check when continuing an EXISTING branch (`continue_existing_pr: true`), because the branch already exists and its name is a given. The disposable-model `createWorktree` backstop SHALL mirror this carve-out — skipping its convention check when acquiring in resume-from-remote-branch mode. Regardless of continuation, the tool SHALL refuse a change targeting a protected branch (the repository's default branch, `main`, or `master`). Existing-work detection SHALL use the pool's mode-agnostic branch lookup (`findByBranch`) plus the branch→session lookup — not a disposable-mode path probe — and SHALL report what continuation will do so Claude can narrate it before any button is clicked; propose-time reporting is advisory only (enforcement stays at execution time).

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

#### Scenario: Existing work detection is pool-based and continuation-aware
- **GIVEN** the pool's `findByBranch` and/or the branch→session lookup report existing work for the specified branch
- **WHEN** Claude calls `propose_change`
- **THEN** the tool returns success with the ref ID plus existing-work metadata (status, last activity)
- **AND** the metadata includes a `continuation` state: `resume-here` (session belongs to this conversation), `adopt` (session alive in another conversation and adoptable — named owner, will be moved here on start), `live` (a run is executing in another conversation — steer the user there), or `fresh` (no session; normal cold continuation)
- **AND** the tool's Claude-facing text explains the consequence of each state

#### Scenario: Reusable-mode branch is detected at propose time
- **GIVEN** the reusable pool is enabled and a `worker-N` folder currently holds the specified branch
- **WHEN** Claude calls `propose_change`
- **THEN** the existing-work metadata is populated (the former disposable-mode path probe found nothing in this mode)

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
