# Design — recover-failed-changes

## Context

When `executeChange` fails, `startChangeWorkflow` sets the active change to `failed` (src/changes/workflow.ts:324) and returns. From there:

- `handleFollowUp` rejects every command on a terminal status (`failed`, `completed`, `cancelled`) at workflow.ts:388.
- The worker claim is never released: the only `pool.release` call is in `monitor.ts` for externally merged/closed PRs, and the idle-release sweep targets `pr_created` sessions only. The worker stays `busy`, and other sessions targeting the branch throw `AlreadyInFlight` (reusablePool.ts:151).
- Setup-hash healing (`maybeRerunSetup`) runs only on the branch-*switch* acquire path (reusablePool.ts:171). The branch-sticky idle path (141-145) and same-session busy path (148-149) skip it, so a worktree that failed because setup instructions changed re-fails on any in-place retry.
- Boot reconciliation (`reconcilePoolState`) resets `busy → idle`, which is why restarting the bot is currently the only working retry path.

Useful existing plumbing: resume-context building from persisted state (workflow.ts:226-241), branch reset via `switchBranch` (`git checkout -B <branch> origin/<default>`), the dirty-check/quarantine machinery, the release path, and the dev+-gated change-thread button registration in `changeThreadActions.ts`.

## Goals / Non-Goals

**Goals:**

- A failed change is recoverable from its own thread: Continue (resume), Start over (reset + redo), Discard (give up, free the worker).
- Recovery heals stale setup before re-entering execution.
- Workers claimed by failed sessions are eventually freed without losing unpushed work.
- Any dev+ can trigger recovery, not just the original requester (matches the existing button gate).

**Non-Goals:**

- Post-restart button recovery. `restore.ts` keeps skipping `failed` sessions; after a restart the boot reconcile frees the worker and the existing propose-same-branch resume path applies. The recovery buttons cover the common case (failure noticed while the bot is up).
- A general "operations on a worker" surface (ad-hoc debug sessions on arbitrary workers) — separate idea, separate change.
- New config knobs. The sweep reuses `idleReleaseHours`.

## Decisions

### 1. Recovery as new follow-up commands, status-gated inversely

Add `continue` / `restart` / `discard` to the `FollowUpCommand` union, handled inside `handleFollowUp`. The terminal-status guard becomes command-aware: recovery commands are admitted **only** when status is `failed`; all existing commands keep their current guards (review/update/merge/close still reject `failed`). `completed` and `cancelled` stay terminal for everything.

*Alternative considered:* a separate handler bypassing `handleFollowUp`. Rejected — follow-up already owns re-acquire, handle capture, busy-status guarding, and thread re-engagement; recovery needs all of it.

### 2. Continue = re-enter execution with resume context + explicit setup heal

`continue` transitions `failed → executing` and re-runs the execution path with `resumeContext` built exactly like the pre-existing-worktree branch of `startChangeWorkflow` (phase + last message from `state.json`). Because the same-session acquire returns the busy worker untouched, the recovery path explicitly invokes the setup-version check and the idempotent install step before execution. The continued run then flows through the unchanged state machine: `pr_created`/`completed`, or `failed` again — which re-posts the failure message with the same recovery buttons (the loop the user asked for).

### 3. Start over = forced worktree reset, no quarantine

`restart` is an explicit "scrap it" — it force-resets the worktree (`git checkout -B <branch> origin/<default>` + clean untracked) **bypassing** the dirty-quarantine check, then runs setup heal + install and re-executes the original request with no resume context. Quarantine exists to protect work from *implicit* loss (sweeps, branch switches); an explicit dev-clicked Start over is informed consent.

### 4. Discard = normal release semantics (dirty → quarantine)

`discard` sets status `cancelled` and releases the worker through the existing release path: clean workers return to the pool; dirty-tracked files trigger the existing quarantine (work preserved, admin can recover). Disposable mode: `discard` maps to the existing worktree cleanup (`rm -rf`), mirroring close-PR cleanup.

*Alternative considered:* Discard force-cleans like Start over. Rejected — Discard means "I don't want this change," not "this work is worthless"; quarantine keeps the safety net for unpushed edits.

### 5. Sweep extension: failed sessions release after `idleReleaseHours`, with unpushed-commit protection

The monitor's idle-release sweep widens from `pr_created`-only to also cover sessions whose change is `failed` (no live handle, `lastActivityAt` older than the window). One new safety rule, applying to the failed-session case: a worker whose branch has **committed-but-unpushed work** (ahead of its upstream, or upstream missing) is quarantined rather than released. The existing dirty-check only sees uncommitted tracked files; for `pr_created` sessions unpushed commits can't exist (the PR implies a pushed branch), but a failed change typically died mid-work with local-only commits — and a clean release followed by a later `checkout -B` from origin would silently destroy them.

### 6. Failure message carries the recovery buttons

The execution-failure message posted to the thread gains the three buttons (♻️ Continue / 🔄 Start over / 🗑️ Discard), registered in `changeThreadActions.ts` alongside the existing follow-up buttons — same dev+ role gate (defense-in-depth `getRole` check), same thread re-engagement side effect. Button labels and any new message text go through `t()` with EN/FR entries.

### 7. Branch-sticky acquire path gains the setup-hash check

Independent of recovery: the `acquire` path that claims an idle worker already on the requested branch (reusablePool.ts:141-145) now runs `maybeRerunSetup` + the install step before claiming, identical to the branch-switch path. This closes the standing gap where editing `worktree_setup_instructions.md` never heals a worker that stays on one branch.

## Risks / Trade-offs

- [Continue on a worktree broken beyond setup (corrupt git state)] → Claude's run fails again and the loop re-offers Start over/Discard; Start over's forced reset is the escape hatch.
- [Start over destroys unpushed work on an explicit click] → accepted by design (informed consent); button label should make "discards current work" explicit.
- [Sweep-quarantine of failed-session workers increases admin burden] → only triggers when real unpushed work exists; the alternative (silent loss) is worse. Quarantine already has a Home-Tab recovery flow.
- [Two concurrent devs click recovery buttons] → the `failed → executing` transition is guarded by the existing busy-status check in `handleFollowUp`; the second click gets the "currently executing" rejection.
- [Failed sessions now count as active again after Continue] → correct behavior (the cap exists to bound concurrent executions), but worth a test so the cap doesn't block Continue itself (status flips before the cap check runs only on *new* changes, not follow-ups).

## Open Questions

None blocking. (Post-restart recovery deliberately deferred — see Non-Goals.)
