## REMOVED Requirements

### Requirement: Per-Repository Verification Checks Configuration

**Reason**: The local pre-push verification gate is removed; `git_push` no longer loads `verification_checks.json`. Verification now runs against real CI via `await_ci` (see `worker-ci-verification`).
**Migration**: Rely on GitHub CI check-runs surfaced by `await_ci`. Existing `verification_checks.json` files are left in place but are inert (no longer consulted by `git_push`).

### Requirement: Verification Gate Execution

**Reason**: `git_push` no longer executes verification checks in the worktree before pushing; the slow local gate (4–15 min observed) is replaced by CI verification after the PR exists.
**Migration**: Run tests before committing (worker instructions still mandate this) and verify outcomes via CI check-runs through `await_ci`.

### Requirement: Retry Budget Tracking

**Reason**: With no push-time gate, there is no per-push retry budget to track; `git_push` no longer increments or reads `verificationAttempts`.
**Migration**: None required. CI failures are surfaced by `await_ci` and handled by the worker workflow (`worker-ci-verification`).

### Requirement: Failure Surfacing to the Worker

**Reason**: There is no gate failure to surface from `git_push`; CI failures are surfaced by `await_ci` instead, including failing check names and details URLs.
**Migration**: Consume `await_ci`'s `failedChecks` payload rather than the gate's failure payload.

### Requirement: Execution Logging

**Reason**: The gate no longer runs, so its per-check execution log lines are no longer emitted by `git_push`.
**Migration**: CI verdicts are reported through `await_ci` and the worker's status reporting.

### Requirement: Gate Disabled Behavior

**Reason**: The gate is unconditionally absent from the push path, so "disabled vs enabled" behavior no longer applies to `git_push`.
**Migration**: None required; `git_push` always pushes without running local checks.
