## 1. GitHub check-runs reader

- [x] 1.1 Add a check-runs reader in `src/changes/pr.ts` (alongside `getPRStatus`): resolve the PR head SHA via `octokit.pulls.get`, then `octokit.checks.listForRef({ owner, repo, ref: headSha })`, classify each run, and return a snapshot `{ status: "all_passed" | "some_failed" | "in_progress" | "no_checks", failedChecks: [{name, conclusion, detailsUrl}], pendingChecks: [name] }`; return null on error

## 2. git_push hardening (`src/tools/worker/gitPush.ts`)

- [x] 2.1 Add optional `force?: boolean` to the tool schema
- [x] 2.2 Add a protected-branch guard: refuse when target equals `repo.branch || "main"` or is in a protected set (`main`, `master`), returning a structured error (no throw)
- [x] 2.3 Implement lease-only force path: when `force` is true, `git fetch origin <branch>` then push with `--force-with-lease --force-if-includes`; never bare `--force` (extend `MinimalGit` with `fetch`)
- [x] 2.4 Keep the same-name refspec (`origin <branch>`) for both normal and force pushes; keep the existing fresh-token remote refresh before pushing
- [x] 2.5 Remove the verification-gate pre-step: drop `loadVerificationConfig` / `runVerificationChecks` / `getActiveChange` retry-budget logic and their `GitPushDeps`
- [x] 2.6 Map push failures to structured `{ success:false, error, details }` results (hook / auth / remote-rejection) without escalating to bare `--force`

## 3. await_ci tool (`src/tools/worker/awaitCi.ts`)

- [x] 3.1 Create `await_ci` worker tool that resolves the active change's PR URL from `getActiveChange(ctx.sessionId)?.prUrl` (error if absent — tell Claude to call `ensure_pr` first), then polls the check-runs reader server-side with bounded backoff (injectable `sleep`; cap ~10 min, interval ~15s)
- [x] 3.2 Return `{ state: "passed" | "failed" | "pending" | "timed_out", failedChecks: [...], pendingChecks: [...] }` per the spec scenarios (some_failed → failed early; all_passed → passed; no_checks throughout → pending; in_progress at cap → timed_out)
- [x] 3.3 Ensure the tool never throws (GitHub API errors become a structured error result distinct from a passed/failed verdict)

## 4. Worker SDK hook: block raw git push (`src/changes/execution.ts`)

- [x] 4.1 Add a `PreToolUse` hook (matcher `Bash`) to the worker SDK `options.hooks` that denies any command invoking `git push` (deny decision + reason steering to `git_push`), leaving `fetch`/`pull`/`rebase`/other git untouched; extract the matcher predicate into a small testable pure function

## 5. Tool registration & gating (`src/tools/server.ts`)

- [x] 5.1 Register `await_ci` in `buildWorkerTools` (parity with `git_push` availability across all worker purposes)
- [x] 5.2 Confirm worker mode no longer depends on the verification gate at push time

## 6. Worktree branch invariant (`src/worktrees.ts`)

- [x] 6.1 In the worktree-creation path in `src/worktrees.ts` (`createWorktree`, before `git worktree add`), assert the branch name passes `isValidBranchName` (from `src/changes/branchNaming.ts`) so a default/protected/non-`clack/` name is refused before touching the filesystem — a defensive backstop to `propose_change`'s upstream `BRANCH_PATTERN` check

## 7. Worker workflow & instructions

- [x] 7.1 Update the **core** worker workflow prompt in `src/changes/execution.ts` (the numbered steps near lines 325–335 — applies to all repos) so the terminal sequence is push → `ensure_pr` → `await_ci` → CI-gated sign-off (no blind `git_push` as the end); leave repo-specific test commands in the per-repo `changes_instructions.md`
- [x] 7.2 In that core prompt, instruct Claude per `await_ci` outcome: run tests before committing; on `passed` report success; on `failed` surface failing checks and `report_status` "CI failed"; on `timed_out`/`pending` `report_status` "CI unresolved" without claiming success

## 8. Tests

- [x] 8.1 `gitPush.test.ts`: force-with-lease path (incl. pre-fetch), protected-branch refusal, same-name refspec, gate-removal (no verification calls), failure mappings, never-bare-force
- [x] 8.2 New `awaitCi.test.ts`: passed / failed (failedChecks) / pending (no checks) / timed_out (pendingChecks) / API-error→structured-result, never-throws
- [x] 8.3 New test for the `git push` PreToolUse matcher predicate: denies `git push`, `git push --force-with-lease`, refspec pushes; allows `git fetch`/`pull`/`rebase`/`status`
- [x] 8.4 Worker tool-gating test (`src/tools/server.test.ts`): both `git_push` and `await_ci` registered for all worker purposes (execute, update, review, merge, close)
- [x] 8.5 `src/worktrees.test.ts`: `createWorktree` refuses a default/protected/non-`clack/` branch name (via `isValidBranchName`)

## 9. Verify

- [x] 9.1 `npx tsc` type-check clean; `npx oxlint` and `npx oxfmt --check` clean on touched files
- [x] 9.2 `npm test` green
- [ ] 9.3 Manual/operator note (NOT done in code): enable GitHub branch protection on `master`/`main` (no direct push, no force-push) as the external backstop
