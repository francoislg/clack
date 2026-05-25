## Context

Worker-mode Claude runs inside a git worktree and invokes MCP tools (`git_push`, `ensure_pr`, `report_status`) to ship its work. The current `EXECUTION_SYSTEM_PROMPT` in `src/changes/execution.ts:268` already tells the worker to run typecheck/test/lint before committing, but the worker often skips this. The result: PRs that don't compile, fail tests, or introduce obvious regressions.

Adding more prose to the system prompt will not fix this — instruction adherence is the failure mode. We need a deterministic gate that the worker cannot talk its way past.

The two existing per-repo customization hooks — `changes_instructions.md` (prompt content) and `worktree_setup_instructions.md` (separate Claude run at worktree creation) — both use the two-tier resolution chain in `src/instructions.ts` (`data/configuration/` → `data/default_configuration/`). A new gate should reuse that resolution pattern for consistency.

## Goals / Non-Goals

**Goals:**
- Make it impossible for the worker to push code that fails repo-defined, deterministic checks (typecheck, tests, lint, etc.).
- Feed failing command output back to the worker as a structured tool error so its resumed SDK session can self-correct on the next tool call.
- Cap retries to prevent infinite loops when the worker cannot fix the failure.
- Make the gate opt-in per repository so existing repos behave identically until they add a config file.
- Keep the failure visible in Slack via the existing stream/execution-log surfaces.

**Non-Goals:**
- Subjective review (bug hunting, architectural critique). That is a separate LLM pass, explicitly deferred to a follow-up change.
- Enforcement at any layer beyond `git_push` (no GitHub branch protection changes, no CI modifications).
- New Slack UI surfaces. The existing tool-call stream and thread messages carry the feedback.
- Sandboxing / isolation. Checks run with full worktree filesystem access, like any other worktree command.

## Decisions

### Decision 1: Interpose the gate inside the `git_push` MCP tool, not as a workflow-orchestrator step

**Chosen:** Modify `createGitPushTool` in `src/tools/worker/gitPush.ts` so that before the actual `git push`, it runs the configured checks. If any fails, `git_push` returns an `errorResult` with the failure summary instead of pushing.

**Alternatives considered:**
- **Orchestrator-driven gate in `executeChange`:** after the worker's SDK session ends, have the workflow run the checks and do the push itself. Rejected because it would require moving `git push` out of the worker's tool surface and adding a second worker invocation to drive the retry. Keeping the gate inside `git_push` means the existing SDK session drives the retry naturally — the worker sees the tool error, reasons about it, edits files, re-commits, calls `git_push` again.
- **Git pre-push hook:** cleaner in theory, but hook state is shared across worktrees on the same repo clone and is fragile to set up per-env. Also loses the structured error path back to the worker.

### Decision 2: Per-repo config via JSON file resolved through the existing two-tier chain

**Chosen:** `{repo}/verification_checks.json` resolved via `resolveInstructionFile` (so user overrides in `data/configuration/` beat shipped defaults in `data/default_configuration/`, matching the pattern for `changes_instructions.md`).

**Schema (v1):**
```json
{
  "checks": [
    { "name": "typecheck", "command": "npx tsc --noEmit", "timeoutSeconds": 300 },
    { "name": "test",       "command": "npm test",          "timeoutSeconds": 600 },
    { "name": "lint",       "command": "npm run lint",      "timeoutSeconds": 120 }
  ],
  "retryBudget": 3
}
```
- `checks` executes in declared order; the first failure stops further checks and returns the failure to the worker. (Running all is noisier and rarely useful — the worker should fix one failure at a time.)
- `timeoutSeconds` per check, defaults to 300s.
- `retryBudget` caps gate-fail cycles. Default 3. When exceeded, `git_push` returns a distinguishable permanent error and the workflow terminates without a PR.
- If the file is absent, `git_push` behaves exactly as today.

**Alternatives considered:**
- **YAML:** rejected because the codebase has no existing YAML parser and JSON is sufficient.
- **Embedding in `config.json`:** rejected because per-repo verification config belongs with other per-repo files, not in the global config.
- **Markdown (consistent with other instruction files):** rejected because this config is structured data, not prose. Mixing structured config into markdown would require parsing conventions.

### Decision 3: Retry budget tracked in the active change state, not per-tool-call

**Chosen:** Add a `verificationAttempts: number` counter to `ActiveChangeState` (in `src/changes/activeState.ts`). Incremented each time the gate fails. When it reaches `retryBudget`, the next `git_push` call returns a terminal error and execution ends.

**Rationale:** tracking in the ActiveChange means the counter survives within a single change session but resets on a fresh change (new branch = new counter). Per-tool-call tracking would lose state across calls; per-process-global would leak across changes.

### Decision 4: Failure output format handed back to the worker

**Chosen:** When a check fails, `git_push` returns:
```
Verification check "<name>" failed (exit code <N>).

<last 80 lines or 6KB of combined stdout+stderr, whichever is smaller>

Fix the failures and try again. You have <M> retry attempts remaining.
```

Truncation uses tail-first (most-recent output is the most useful for error messages). The remaining-attempts line helps the worker decide whether to keep trying or bail via `report_status`.

### Decision 5: Which follow-ups trigger the gate

Because the gate lives inside `git_push`, it applies anywhere the worker pushes: initial execution, `update` follow-up, `review` follow-up. `merge` and `close` do not push code, so no gate runs. No special casing needed at the workflow layer.

### Decision 6: Execution mechanics

Checks run via `child_process.spawn` with `shell: true`, `cwd` set to the worktree path, environment inherited from the worker process (so `PATH`, `NODE_PATH`, etc. match what the worker had). stdout and stderr are captured into a combined buffer, capped at ~64KB to avoid memory pressure on runaway output. Each check is killed with SIGTERM on timeout.

Log every check start and outcome via `appendExecutionLog(branchName, ...)` — users browsing session logs see "Verification: typecheck — passed (4.2s)" / "Verification: test — FAILED (exit 1, 38s)".

## Risks / Trade-offs

- **Risk:** slow checks (e.g., full test suite) add minutes to every push attempt, including cases where the worker is pushing something trivial. → Mitigation: per-repo config lets maintainers choose which checks to run; fast-feedback checks like typecheck can be the only ones in the list. Follow-up could add per-check "only run if files match glob X" filtering, but that's deferred.
- **Risk:** checks pass locally but fail in CI due to env differences. → Mitigation: the gate is a best-effort pre-check, not a CI replacement. Repos that want hard enforcement should still keep CI as the final gate.
- **Risk:** worker exhausts retry budget on a transient flake (e.g., network hiccup in tests). → Mitigation: the user sees the failure in the thread and can ask the worker to try again via `/update` (new retry budget in the new invocation). Bounded, visible, recoverable.
- **Risk:** commands configured by users could have side effects outside the worktree (e.g., calling an external API). → Mitigation: explicitly not our problem — admins control the config file and are trusted; same trust model as `worktree_setup_instructions.md`.
- **Trade-off:** running checks inside `git_push` couples the tool to gate logic. An alternative with a separate `run_verification` tool would be more modular but would require the worker to sequence "verify then push," which defeats the point (the worker could skip verification and call push directly).

## Migration Plan

1. Ship the code change with no default config in `data/default_configuration/`. All existing repos continue to behave identically.
2. Document the config schema in the repo-instruction docs and in `data/default_configuration/dev/changes.md`.
3. Maintainers opt in per repository by adding `data/configuration/<repo>/verification_checks.json`.
4. No rollback needed beyond deleting the config file; without one the gate is a no-op.

## Open Questions

- Should the gate also run on `merge`/`close` as a sanity check even though those don't push code? Current answer: no (they don't change the tree), but revisit if we find failure modes.
- Should `retryBudget: 0` be allowed (= gate is advisory, failure doesn't block)? Current answer: no for v1; the whole point is enforcement. Advisory mode can come later if asked.
- Should failed-check output be posted as its own Slack message (in addition to appearing in the tool-call stream) so users see it without clicking into the thread's tool events? Current answer: defer — the existing stream surfaces it, and adding a discrete message is easy to add later if needed.
