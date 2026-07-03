# tester-mode — delta for add-run-test-new-branch

## MODIFIED Requirements

### Requirement: Test requests are staged via a run_test action intent

When the feature is enabled, Claude SHALL detect a test request (e.g. "test this PR") and stage a test intent via a `run_test` action tool that mirrors `propose_change`. The tool SHALL be available only to dev+ users. The staged intent SHALL identify the target repository and the branch/PR to test.

The tool SHALL accept an optional `new_branch: boolean` argument. When `new_branch` is `true`, the staged intent SHALL carry `resumeRemoteBranch: false`, so the run creates a fresh throwaway branch off the repository's default branch instead of resuming an existing remote branch. When `new_branch` is omitted or `false`, the staged intent SHALL carry `resumeRemoteBranch: true`, preserving existing behavior exactly. The tool description SHALL instruct Claude to use `new_branch: true` when the user asks to test or record current behavior (no PR in play) and to name the branch a throwaway slug (e.g. `test/record-feature-x`). The protected-branch guard SHALL apply in both modes.

#### Scenario: Dev user requests a test in a thread

- **WHEN** a dev+ user says "test this PR" in a thread and the feature is enabled
- **THEN** Claude stages a `run_test` intent resolving the target repo and branch, surfaced to the user as a test action

#### Scenario: Below-threshold user requests a test

- **WHEN** a user below the dev role requests a test
- **THEN** the `run_test` tool is not offered and no tester run is started

#### Scenario: Target cannot be resolved

- **WHEN** a test is requested but no PR/branch can be resolved from the thread context and the request references a PR or branch
- **THEN** no intent is staged and Claude asks the user to name the branch or PR explicitly

#### Scenario: User asks to record current behavior without a PR

- **WHEN** a dev+ user asks to test or record a feature as it works today (no PR referenced)
- **THEN** Claude stages a `run_test` intent with `new_branch: true` and a throwaway branch name, and the staged intent carries `resumeRemoteBranch: false`

#### Scenario: new_branch omitted keeps resume semantics

- **WHEN** a `run_test` intent is staged without `new_branch`
- **THEN** the staged intent carries `resumeRemoteBranch: true`, byte-for-byte identical to pre-change behavior

#### Scenario: Protected branch still rejected with new_branch

- **WHEN** `run_test` is called with a protected branch name (e.g. `main`), regardless of `new_branch`
- **THEN** the tool returns an error and no intent is staged

### Requirement: Tester acquires a worktree on the target branch

A tester run SHALL acquire a worktree on the target branch, reusing existing worktree provisioning (branch checkout, unique ports, `.env`, install step). When the staged intent carries `resumeRemoteBranch: true` (the default), it SHALL check the branch out from its own remote head using the existing cold-PR resume path so the PR's commits are preserved, and a missing remote branch SHALL fail the run rather than clobber any branch. When the staged intent carries `resumeRemoteBranch: false` (staged via `new_branch: true`), it SHALL create the branch fresh from `origin/<default>` using the existing fresh-branch acquire path.

#### Scenario: Branch exists on the remote

- **WHEN** a tester run targets an existing PR branch (default mode)
- **THEN** the worktree is acquired from `origin/<branch>` with the PR's commits intact and the provisioned ports/`.env`

#### Scenario: Branch missing on the remote

- **WHEN** the target branch does not exist on the remote and the intent carries `resumeRemoteBranch: true`
- **THEN** the run fails with a clear error and no worktree or branch is modified

#### Scenario: Fresh branch off the default branch

- **WHEN** a tester run was staged with `new_branch: true`
- **THEN** the worktree is acquired on a fresh branch created from `origin/<default>` with the provisioned ports/`.env`, and no remote-branch existence check is performed
