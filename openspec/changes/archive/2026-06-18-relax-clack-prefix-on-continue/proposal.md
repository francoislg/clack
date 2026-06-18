## Why

The `propose_change` tool hard-rejects any branch name that doesn't match `clack/{type}/{name}`. That's correct for brand-new branches, but it also blocks continuing an **existing** branch that a human (or another tool) created with a different naming convention — e.g. resuming `feature/foo` to address review comments. The naming rule only makes sense at branch *creation*; for a continuation, the branch already exists and its name is a given.

## What Changes

- When `propose_change` is called with `continue_existing_pr: true`, the `clack/{type}/{name}` convention check is **skipped** — any branch name is accepted, because the work is continuing a branch that already exists rather than minting a new one.
- When `continue_existing_pr` is absent/false (a new branch), the convention is enforced exactly as today.
- The `createWorktree` backstop in `worktrees.ts` is relaxed the same way: it skips the `isValidBranchName` guard when `resumeRemoteBranch` is true (the flag it already receives), so the disposable-pool path agrees with the tool gate.
- Safety is preserved by the existing resume machinery: the resume path resolves `origin/<branch>` and throws `RemoteBranchNotFound` if the branch isn't actually on the remote, so a relaxed name can never create a junk non-prefixed branch.
- A protected-branch refusal is made explicit so relaxing the convention can't let a change target the default branch / `main` / `master`: `propose_change` and the `createWorktree` backstop both reject protected branch names regardless of the continuation flag. The protected-branch list (previously private to `git_push`) becomes a shared `isProtectedBranchName` helper in `branchNaming.ts`.
- `propose_change`'s `continue_existing_pr` description is broadened to cover continuing an existing remote branch with or without a PR (not just an open PR), so Claude reaches for the flag in the right cases.
- `propose_spinoff` (always a new sibling branch) and `git_push`'s protected-branch check are **unchanged**.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `changes-workflow`: the branch-validation requirement gains a continuation carve-out — the `clack/{type}/{name}` convention is enforced for new branches but skipped when continuing an existing branch (`continue_existing_pr: true`).

## Impact

- `src/changes/branchNaming.ts` — add the shared `isProtectedBranchName` helper + `PROTECTED_BRANCH_NAMES`.
- `src/tools/actions/proposeChange.ts` — gate `BRANCH_PATTERN` check behind `!continue_existing_pr`; refuse protected branches regardless of the flag; broaden the flag's description.
- `src/worktrees.ts` — `createWorktree` skips the `isValidBranchName` backstop when `resumeRemoteBranch` is true, but still refuses protected branches.
- `src/tools/worker/gitPush.ts` — reuse the shared `isProtectedBranchName` instead of a private copy (no behavior change).
- No config, schema, or persisted-state changes. No new dependencies.
- Behavior for new branches (the common case) is unchanged.
