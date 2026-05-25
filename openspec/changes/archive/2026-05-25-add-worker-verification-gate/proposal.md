## Why

Worker-mode executions routinely ship broken code: typechecks are skipped, test suites aren't run, and the worker does not self-assess whether its changes introduce bugs. The `EXECUTION_SYSTEM_PROMPT` in `src/changes/execution.ts` already instructs the worker to run tests and linters before committing, but the instruction is regularly ignored. More instructions do not fix ignored instructions — a deterministic gate does.

## What Changes

- Add a **pre-push verification gate** to the worker-mode change execution flow.
- Define a per-repository configuration file that lists shell commands to run as verification checks (e.g., typecheck, test, lint).
- After the worker reports success and before `git_push` is permitted, the workflow runs each configured command against the worktree. All must exit 0 for the gate to pass.
- When any check fails, the captured stderr/stdout is handed back to the worker as a resumed-session prompt instructing it to fix the failures, up to a bounded retry budget.
- When the retry budget is exhausted, the change is reported as failed in the Slack thread with the failing command output, the PR is not created, and the worktree is preserved so the user can resume via the normal follow-up commands.
- The gate is opt-in per repository: if no configuration file is present, execution behaves exactly as it does today.

## Capabilities

### New Capabilities
- `worker-verification-gate`: Deterministic, scripted verification pass between worker completion and `git_push`. Owns the check-command config schema, execution mechanics, retry loop, and failure surfacing.

### Modified Capabilities
- `worker-tools`: `git_push` now runs configured verification checks before pushing. On check failure it returns a structured error to the worker without pushing; after the retry budget is exhausted it returns a terminal error.

## Impact

- **Code:** `src/changes/execution.ts` (insert gate between worker run and push), new module under `src/changes/` for gate execution, `src/config.ts` (or new config loader) for the per-repo check config, tests for all.
- **Config:** New per-repository file (e.g. `data/configuration/<repo>/verification_checks.{json,yaml}` — exact location TBD in design). Schema: ordered list of `{ name, command, timeoutSeconds? }`. Absence = gate disabled.
- **Workflow:** `startChangeWorkflow` and the `update` follow-up path both invoke the gate; `review`, `merge`, `close` do not.
- **Tools:** No change to MCP tool surface. The worker continues to call `git_push` as it does today — the gate interposes server-side.
- **No breaking changes.** Existing repos without a config file see unchanged behavior.
