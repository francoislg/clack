## Context

Worker mode (`src/changes/execution.ts`) runs Claude in a git worktree under `permissionMode: "bypassPermissions"` with the `Bash` tool always available (`execution.ts:375`). Pushing happens through the `git_push` MCP tool (`src/tools/worker/gitPush.ts`), which today:

1. Runs a per-repo local verification gate (`verification_checks.json` → `runVerificationChecks`) before pushing, with a retry budget. For `applauz-monorepo` that check is `pnpm test:ts` with a 900 s timeout. Measured across ~12 sessions, the gate takes 4–15 min; the actual `git push` takes 7–14 s.
2. Permanently rewrites `origin` to a token-embedded URL (`getAuthenticatedCloneUrl` → `https://x-access-token:<token>@…`, `github.ts:175`) and runs a plain `git push -u origin <branch>` — no force option.

Because there is no force-push, a rebase (which diverges the branch) makes `git_push` fail with non-fast-forward, and Claude falls back to raw `git push --force-with-lease` via the Bash tool. This was confirmed verbatim in worker-1 session logs, including a "stale info" lease rejection in a fresh worktree. The raw-bash push is entirely unguarded and only succeeds because `git_push` already baked a token into `origin`.

The background monitor (`src/changes/monitor.ts`) is cleanup-only: it detects externally merged/closed PRs and releases worktrees. It holds **no Slack client and cannot post to a thread or re-engage Claude**. Thread re-engagement happens solely via user-driven replies (`core.ts` `findSessionByThread`). This rules out an async "fire-and-forget, report later" CI verdict without building a new delivery path.

## Goals / Non-Goals

**Goals:**
- Take the slow local pre-push gate off the critical path of every push.
- Support force-push as `--force-with-lease` (with `--force-if-includes`) **only**, never bare `--force`, done reliably even in a fresh worktree with a stale tracking ref.
- Guarantee a worker push can never land on `master`/`main` (or any protected branch), defended in depth.
- Verify the change against **real CI** before the worker signs off, keeping the verdict in the live stream (no new delivery infra).

**Non-Goals:**
- Async CI reporting via the background monitor (would require a new Slack-posting / re-engagement path — explicitly deferred).
- Changing query-mode (non-worker) behavior.
- Deleting existing `verification_checks.json` files or the gate code's tests beyond what the spec requires; the gate simply stops being invoked by `git_push`.
- Configuring GitHub branch protection (operator action, tracked in the proposal's Impact).

## Decisions

### D1: Force-push is lease-only, with a pre-fetch to avoid stale leases
Add `force?: boolean` to `git_push`. When set, push with `git push --force-with-lease --force-if-includes`. Before the lease push, run `git fetch origin <branch>` so the remote-tracking ref is populated — otherwise `--force-with-lease` rejects with "stale info" in a fresh/reused worktree (the observed failure). `--force-if-includes` adds protection against clobbering remote commits the local ref hasn't seen.
- *Alternative considered*: bare `--force`. Rejected — defeats the safety the user explicitly required ("ONLY with lease").
- *Alternative considered*: `--force-with-lease=<ref>:<sha>` with an explicitly fetched SHA. More precise but more moving parts; the `fetch` + plain `--force-with-lease` is simpler and sufficient.

### D2: Default/protected-branch refusal inside git_push
Before any push (forced or not), refuse when the target branch equals the repo's default branch (`repo.branch || "main"`) or is in a protected-name set (`main`, `master`). The push retains its same-name refspec (`origin <branch>`) so source and destination cannot diverge onto a protected ref. This is belt-and-suspenders to the upstream `BRANCH_PATTERN` (`branchNaming.ts:2`), which already requires `clack/{type}/…`.

### D3: PreToolUse hook = raw-bash push lockout
Add a `PreToolUse` hook to the worker SDK invocation (`execution.ts`, threaded through `clackSession` → SDK `options.hooks`) that inspects `Bash` tool calls and returns `permissionDecision: "deny"` for any command that invokes `git push`, steering Claude to the `git_push` tool. `git fetch`, `git pull`, `git rebase`, and every other git command are left untouched. A raw `git push` from Bash is therefore refused outright, forcing all pushes through `git_push` (where D1/D2 apply); the protected-branch refusal there + GitHub branch protection (E) then guarantee no push reaches `master`.
- *Why not token-less origin* (set `origin` to a token-less URL and authenticate each push via an explicit URL argument): `origin` is authenticated in six places (`execution.ts:304` before every run, `worktrees.ts:124`, `reusablePool.ts:361`, `branchSwitch.ts` ×3) precisely so the worker can `git fetch`/**rebase**. Stripping the token to block pushes would also break those fetches — and rebase is the motivating workflow. The hook blocks only `push`, so fetch/rebase keep working.
- *Threat model*: this guards against accidental/naive direct pushes (e.g. the raw `git push --force-with-lease` fallback Claude reached for on a rebase), not an adversary obfuscating the command. GitHub branch protection (E) is the bug-proof backstop for anything the hook's `git push` match misses.
- The hook matches on `tool_name === "Bash"` and tests `tool_input.command` for a `git push` invocation; `git_push` is an MCP tool (`mcp__clack__git_push`), not Bash, so it is never caught.

### D4: Remove the local pre-push gate; verify via real CI
`git_push` stops loading/running `verification_checks.json` and stops touching the push-time retry budget. Verification moves to a new `await_ci` tool: given the active PR, it polls GitHub check-runs for the head SHA server-side with bounded backoff and returns one verdict `{ state: "passed" | "failed" | "pending" | "timed_out", failedChecks: [...] }`. Server-side blocking (rather than Claude looping a non-blocking `get_pr_checks`) avoids burning tokens idle-waiting and keeps it a single tool call.
- *Alternative considered*: keep the gate but skip it when HEAD is unchanged. Still runs the slow suite on first push and duplicates CI; rejected.
- *Alternative considered*: block-and-poll driven by Claude. Wastes tokens; server-side blocking is strictly better.

### D5: Worker workflow stops ending on a blind push
The terminal worker action becomes: implement → test → commit → `git_push` → `ensure_pr` → `await_ci` → sign off only on `passed`, report honestly on `failed`/`timed_out`/`pending`. Encoded in the worker prompt and `changes_instructions.md`.

## Risks / Trade-offs

- **Pool worker held during CI** → `await_ci` blocks the worker for the CI window (minutes). Mitigation: bounded cap (e.g. 10 min) returning `timed_out`; the worker is already held through the whole change, and monorepo CI resolves well within a 60-min worker timeout.
- **CI is the only quality signal now; a repo with weak/absent CI loses pre-push checking** → Mitigation: worker instructions still mandate running tests before commit; `await_ci` returning `pending` with no checks is surfaced honestly rather than silently passing.
- **PreToolUse hook over-blocks a legitimate worker `git push`** → Audited: the worker has no legitimate need to push outside `git_push`; `ensure_pr`/`merge_pr`/`close_pr` use Octokit (API), and remote branch deletion (`git push origin --delete`) runs in the host process (`worktrees.ts`), not via the worker's Bash tool, so the hook does not reach it. Mitigation: the matcher targets `git push` only, leaving fetch/pull/rebase free.
- **`--force-with-lease` still mispredicts after an unusual ref state** → Mitigation: pre-fetch + `--force-if-includes`; on lease rejection the tool returns a structured "remote rejected" error rather than escalating to `--force`.
- **Existing `verification_checks.json` becomes silently inert** → Mitigation: documented in the proposal Impact and the gate spec's REMOVED requirements; files are left in place, not deleted.

## Migration Plan

1. Ship `git_push` changes (D1–D4 gate removal) + `await_ci` together so no push path is left without verification.
2. Update worker prompt + `changes_instructions.md` (D5) in the same change.
3. Operator: enable GitHub branch protection on `master`/`main` (no direct push, no force-push) — the bug-proof backstop, independent of this code.
4. Rollback: re-enable the gate by reverting `gitPush.ts` (the gate code and `verification_checks.json` remain on disk), and drop `await_ci` from the worker tool set.

## Open Questions

- `await_ci` cap and backoff schedule (proposed 10 min cap; confirm against typical monorepo CI duration during implementation).
