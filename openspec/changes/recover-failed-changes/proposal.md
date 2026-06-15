# Recover Failed Changes

## Why

A change that fails execution is permanently bricked: `handleFollowUp` treats `failed` as terminal ("This change is already failed. No further actions are possible."), even though the persistence layer explicitly lists failed sessions as resumable and the worktree with all partial work still exists. Worse, the failed session never releases its worker — the only `pool.release` in the lifecycle is the monitor's external-PR-close path, and the idle-release sweep covers only `pr_created` sessions — so in reusable-pool mode the worker stays `busy` until a bot restart, and any other session targeting that branch gets `AlreadyInFlight`. Today, restarting the bot is the only reliable retry mechanism. There is also no way to repair a broken worktree (e.g., one that failed because setup instructions changed): setup-hash healing only runs on the branch-*switch* acquire path, so retrying on the same worktree re-fails with stale setup.

## What Changes

- **`failed` stops being terminal.** The execution-failure message in the change thread offers three recovery actions: ♻️ **Continue** (resume in the same worktree, with resume context built from the persisted phase/last-message), 🔄 **Start over** (reset the worktree to `origin/<default>`, re-branch, re-run the original request fresh), and 🗑️ **Discard** (release the worker back to the pool immediately).
- **Recovery loop:** a continued/restarted change re-enters `executing` and proceeds through the existing state machine (to `pr_created`/`completed`) — or fails again and re-offers the same recovery actions. This is the dev's tool to repair an invalid worktree.
- **Setup healing on recovery:** Continue and Start over run the setup-version hash check (and the idempotent install step) before re-entering execution. The branch-sticky idle acquire path gains the same check, closing the gap where a stale-setup worktree could never heal without a branch switch.
- **Failed sessions release eventually:** the existing `idleReleaseHours` sweep extends to `failed` sessions — after the idle window with no recovery action, the worker is released (dirty tracked files route through the existing quarantine path so unpushed work is preserved; clean workers release normally). No immediate auto-release on failure: the recovery window exists precisely so unpushed work can be fixed and pushed first.
- **Permission rule confirmed and extended:** any dev+ may act on any change's thread buttons — recovery actions included — regardless of who requested the change. (Existing follow-up buttons are already dev+-gated, not requester-gated; the new actions follow the same rule.)
- Disposable mode: the worktree survives failure, so Continue and Start over work there too; Discard maps to the existing `rm -rf` cleanup path.

## Capabilities

### New Capabilities

- `failed-change-recovery`: recovery actions (Continue / Start over / Discard) on failed changes — failure-message buttons, status re-entry into the existing state machine, resume context, worktree reset, setup healing on the recovery paths, and the dev+ permission rule for them.

### Modified Capabilities

- `changes-workflow`: `failed` is no longer terminal for the recovery commands (the follow-up guard admits them while still rejecting review/update/merge/close on failed changes without a PR); worker-pool mediation gains a release-on-discard path.
- `worker-pool`: the **Worker Release Lifecycle** requirement extends the idle-release sweep to workers claimed by `failed` sessions (clean → release, dirty-tracked → quarantine); the **Setup-Version Invalidation** requirement extends the hash check to the branch-sticky idle acquire path (today it only runs on branch switch).

## Impact

- `src/changes/workflow.ts` — follow-up status guard, new recovery command handling, resume-context reuse (the pre-existing-worktree path), status transitions `failed → executing`.
- `src/changes/persistence.ts` / `src/changes/activeState.ts` — failed changes keep their session/activeChange alive for recovery instead of being skipped.
- `src/slack/handlers/changeThreadActions.ts` + failure-message blocks — three new buttons on the execution-failure message; localized strings (`en.ts`/`fr.ts`).
- `src/workers/reusablePool.ts` — `maybeRerunSetup` + install step on the branch-sticky acquire path; release path invoked by Discard.
- `src/changes/monitor.ts` — idle-release sweep widened from `pr_created`-only to also cover `failed` sessions.
- `src/workers/branchSwitch.ts` (or equivalent) — reused for the Start-over worktree reset.
- No config schema changes required (`idleReleaseHours` is reused); no breaking changes — completed/cancelled remain terminal, and pre-existing failed sessions simply become recoverable.
