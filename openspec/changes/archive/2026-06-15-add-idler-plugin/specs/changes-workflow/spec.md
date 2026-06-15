## ADDED Requirements

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
