## Why

Pushing a worker branch is slow and unsafe. Every `git_push` synchronously runs a local verification gate (`pnpm test:ts`, 4–15 min observed across ~12 sessions) while the actual push takes 7–14 s — so the gate, not the push, is the cost. Meanwhile the tool offers no force-push, so a rebase forces Claude into raw `git push --force-with-lease` via the Bash tool, which is unguarded and (because `git_push` permanently bakes a token into `origin`) could push anywhere — including `master`. We want fast pushes, force-push that is **only** `--force-with-lease`, a hard "never push to a protected branch" guarantee, and verification anchored to real CI instead of a slow local gate.

## What Changes

- `git_push` gains an optional `force` flag that pushes with `--force-with-lease --force-if-includes` only — **never** bare `--force`. It pre-fetches the remote ref so the lease isn't rejected as "stale info" (the exact failure observed in a fresh worktree).
- `git_push` refuses to push when the target is the repository's default branch or any protected-branch name, and keeps a same-name refspec so source and destination can never diverge onto `master`.
- A **PreToolUse hook** on the worker run denies any `Bash` command that invokes `git push` (leaving `fetch`/`pull`/`rebase` untouched), so a raw `git push` from the Bash tool is refused and all pushes must go through `git_push`. This is what closes the raw-bash force-push hole without breaking the worker's own rebase/fetch.
- **BREAKING**: The local pre-push verification gate is removed from `git_push`. `git_push` no longer runs `verification_checks.json` and no longer consumes a retry budget on push.
- New `await_ci` worker tool: given the active PR, it polls GitHub check-runs for the head SHA server-side (bounded backoff) and returns a single `{ state, failedChecks }` verdict (`passed` / `failed` / `pending` / `timed_out`).
- Worker workflow no longer ends with a blind `git_push`. After pushing and opening the PR, the worker calls `await_ci` and may only sign off as successful on `passed`; it reports honestly on `failed` / `timed_out`. Worker instructions reinforce: run tests before committing, never sign off on unverified code.

## Capabilities

### New Capabilities
- `worker-ci-verification`: the `await_ci` worker tool plus the requirement that a worker verifies CI status before signing off, replacing the removed local pre-push gate.

### Modified Capabilities
- `worker-tools`: `git_push` gains the `force` (lease-only) parameter, default/protected-branch refusal, and transient-auth restore (raw-bash push lockout); it no longer runs or depends on the local verification gate. The new `await_ci` tool is registered in all worker invocations.
- `worker-verification-gate`: the pre-push blocking gate is removed — `git_push` no longer executes `verification_checks.json` checks or tracks a push-time retry budget.

## Impact

- Code: `src/tools/worker/gitPush.ts` (force param, default-branch guard, gate removal), new GitHub check-runs read in `src/changes/pr.ts`, new `src/tools/worker/awaitCi.ts`, `src/tools/server.ts` (register `await_ci`), `src/changes/execution.ts` (PreToolUse hook blocking Bash `git push` + CI-gated terminal-sequence prompt), `src/worktrees.ts` (assert `clack/…` branch invariant at creation).
- Config: `verification_checks.json` is no longer consulted by `git_push`; existing files become inert (documented, not deleted).
- External (operator action, outside this change): enable GitHub branch protection on `master`/`main` (no direct pushes, no force-push) as the bug-proof backstop.
- Tests: `gitPush.test.ts` (force/guard paths, gate removal), new `awaitCi.test.ts`, worker tool-gating tests, the `git push` PreToolUse-hook matcher, and the worktree branch-invariant guard.
