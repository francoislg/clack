# Tasks — recover-failed-changes

## 1. Worker pool: setup healing + release extensions

- [x] 1.1 Run `maybeRerunSetup` + `runInstallStep` on the branch-sticky idle acquire path in `src/workers/reusablePool.ts` (worker already on requested branch), with unit tests for hash-match (skip) and hash-mismatch (re-run) on that path
- [x] 1.2 Expose a pool method the recovery paths can call to perform the setup-version check + install on an already-claimed worker (same-session busy worker), with unit tests
- [x] 1.3 Add an unpushed-commits check (branch ahead of upstream, or upstream missing) usable by the release sweep; unit-test clean / ahead / no-upstream cases with mocked git boundary
- [x] 1.4 Add a `"discarded"` release reason to the pool release path (normal dirty-check semantics: clean → idle, dirty-tracked → quarantine), with unit tests
- [x] 1.5 Extend the idle-release sweep in `src/changes/monitor.ts` to cover sessions with `activeChange.status === "failed"` (no live handle, past `idleReleaseHours`): clean + fully-pushed → release/detach; dirty OR unpushed commits → quarantine; unit tests for all three outcomes

## 2. Workflow: recovery commands

- [x] 2.1 Add `continue` / `restart` / `discard` to the `FollowUpCommand` union and make the `handleFollowUp` status guard command-aware: recovery commands admitted only on `failed`; existing commands keep current guards; `completed`/`cancelled` terminal for everything; rejection message on a failed change names the recovery options
- [x] 2.2 Implement `continue`: status `failed → executing`, resume context built from persisted `state.json` (reuse/extract the pre-existing-worktree logic from `startChangeWorkflow`), setup check + install (task 1.2) before execution, handle capture for cancellation, then normal state-machine flow
- [x] 2.3 Implement `restart`: force-reset worktree to `origin/<defaultBranch>` (re-create branch, clean untracked, NO quarantine), setup check + install, re-run the original change request with no resume context
- [x] 2.4 Implement `discard`: status → `cancelled`, release via pool with `"discarded"` (reusable) or worktree cleanup (disposable); ensure session/activeChange end state matches the cancelled-change spec
- [x] 2.5 Re-failure loop: a failed recovery run re-posts the failure message with recovery buttons; verify failed sessions retain `activeChange` (no clearing on execution failure)
- [x] 2.6 Unit tests for `handleFollowUp` recovery routing: admitted on failed, rejected on completed/cancelled, busy-status rejection while a recovery is in flight, non-recovery commands still rejected on failed

## 3. Slack surface

- [x] 3.1 Add the three recovery buttons to the execution-failure message blocks (♻️ Continue / 🔄 Start over / 🗑️ Discard), with `t()` strings in `src/i18n/strings/en.ts` + `fr.ts` (Start over copy states it discards current work)
- [x] 3.2 Register the button handlers in `src/slack/handlers/changeThreadActions.ts` with the existing dev+ role gate and thread re-engagement behavior; unit tests for dev click (proceeds), member click (ephemeral rejection), and re-engagement
- [x] 3.3 Verify localization parity test passes (key/placeholder parity, FR ≠ EN)

## 4. Disposable mode

- [x] 4.1 Continue / Start over operate on the surviving disposable worktree (no pool calls); Discard routes to the existing `rm -rf` cleanup; unit tests for all three in disposable mode

## 5. Verification

- [x] 5.1 Update `statusToPhase` / Home Tab / `find_changes` display if the failed-with-recovery state needs distinct copy (confirm none breaks; failed display already exists)
- [x] 5.2 Run `npx tsc`, `npx oxlint`, `npx oxfmt`, and the full `npm test` suite
- [ ] 5.3 Manual smoke (optional): force a failing change, click each recovery button, confirm Continue resumes with context, Start over resets, Discard frees the worker
