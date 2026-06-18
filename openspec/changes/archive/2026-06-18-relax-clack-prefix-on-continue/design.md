## Context

The `clack/{type}/{name}` branch convention is enforced in three places: the `propose_change` tool gate (`proposeChange.ts`, the only gate that blocks a request), the `createWorktree` backstop (`worktrees.ts`, disposable-pool defense-in-depth), and `propose_spinoff` (sibling branches, always new). `git_push`'s protected-branch check is name-based on `{default, main, master}` and never consults the prefix.

Continuation of an existing branch is already a first-class flow: `continue_existing_pr` on `propose_change` → `resumeRemoteBranch` on the staged intent → `ChangePlan` → `createWorktree`/`switchBranch`. The resume path resolves `origin/<branch>` via `resolveRemoteBase`, which throws `RemoteBranchNotFound` when the branch is absent from the remote.

## Goals / Non-Goals

**Goals:**
- Accept any branch name when continuing an existing branch, while keeping the convention mandatory for new branches.
- Keep the change minimal and behavior-preserving for the common (new-branch) case.

**Non-Goals:**
- Changing `propose_spinoff` (always mints a new sibling — convention stays mandatory).
- Changing `git_push` protected-branch logic.
- Adding a propose-time remote-existence check (the resume path already validates existence).

## Decisions

**Use the existing `continue_existing_pr` flag as the new-vs-continue signal.** It is already plumbed end-to-end as `resumeRemoteBranch`, and the resume path is self-validating: a relaxed name on a non-existent branch fails with `RemoteBranchNotFound` rather than creating junk. Alternative considered — verifying `origin/<branch>` exists inside `propose_change` — rejected: it adds a propose-time network call for a guarantee the acquire path already provides.

**Gate both enforcement points on the same flag.**
- `proposeChange.ts`: `if (!args.continue_existing_pr && !BRANCH_PATTERN.test(args.branch)) return errorResult(...)`.
- `worktrees.ts createWorktree`: `if (!resumeRemoteBranch && !isValidBranchName(branchName)) throw ...`. The function already receives `resumeRemoteBranch`.

The reusable pool's `switchBranch` has no prefix guard, so it needs no change — it already accepts whatever name the (now-relaxed) gate allowed.

**Broaden the `continue_existing_pr` description.** Current wording couples to "an EXISTING open pull request." Continuing an existing remote branch that has no PR yet is also valid; reword so Claude reaches for the flag whenever it is continuing a branch that already exists, with or without a PR.

**Keep refusing protected branches, even on continuation.** The `clack/{type}/{name}` convention implicitly blocked changes targeting `main`/`master`/the default branch; relaxing it would let a continuation acquire a worktree on the default branch, where `createWorktree`'s `branch -D` + `checkout -B` could reset the main clone's default branch. So protected-branch refusal is made explicit and independent of the convention: both `propose_change` and the `createWorktree` backstop reject protected names regardless of the flag. The protected-branch list, previously private to `git_push`, is promoted to a shared `isProtectedBranchName` helper in `branchNaming.ts` (single source of truth; `git_push` reuses it with no behavior change).

## Risks / Trade-offs

- [Claude sets `continue_existing_pr: true` to bypass the convention on a name that doesn't exist remotely] → The resume acquire throws `RemoteBranchNotFound`; no branch is created and the user sees an accurate error. No silent fallback to the default branch.
- [A genuinely new branch is given a non-convention name by mis-setting the flag] → Same self-validating failure as above — it cannot exist remotely, so acquisition fails rather than producing an off-convention branch.
- [Backstop error message implies the convention is always required] → Message stays accurate because the backstop only fires on the non-resume (new-branch) path.

## Migration Plan

Pure logic relaxation — no config, schema, or persisted-state changes. Rollback is reverting the two conditionals; no data migration either way.
