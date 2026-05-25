## 1. Config loading

- [x] 1.1 Define `VerificationConfig` and `VerificationCheck` TypeScript types (e.g., in `src/changes/verification/config.ts`)
- [x] 1.2 Implement `loadVerificationConfig(repoName)` that resolves `{repoName}/verification_checks.json` via `resolveInstructionFile`, parses JSON, applies defaults (`retryBudget = 3`, `timeoutSeconds = 300`), and returns `null` when the file is absent
- [x] 1.3 On parse error, log a warning with the file path and error message and return `null` (treat as disabled)
- [x] 1.4 Unit tests: file absent, empty checks array, valid config, missing optional fields get defaults, invalid JSON, wrong field types

## 2. Check execution engine

- [x] 2.1 Implement `runVerificationChecks({ worktreePath, checks, branchName })` in `src/changes/verification/runner.ts`
- [x] 2.2 Execute each check via `child_process.spawn` with `shell: true`, `cwd: worktreePath`, inheriting env
- [x] 2.3 Capture combined stdout+stderr with tail-first truncation at ~64KB
- [x] 2.4 Enforce per-check timeout via SIGTERM
- [x] 2.5 Stop at first failing check; return `{ result: 'pass' } | { result: 'fail', checkName, exitCode, output, durationMs }`
- [x] 2.6 Emit execution-log lines on start, pass, and fail via `appendExecutionLog`
- [x] 2.7 Unit tests: all pass, first fails, second fails (ensures order), timeout, output truncation, missing command (spawn error)

## 3. Retry budget state

- [x] 3.1 Add `verificationAttempts: number` to `ActiveChangeState` in `src/changes/activeState.ts`
- [x] 3.2 Initialize `verificationAttempts = 0` wherever `ActiveChangeState` is constructed (`startChangeWorkflow`, resume paths)
- [x] 3.3 Update `ActiveChangeState` persistence/restore (`src/changes/persistence.ts`, `restore.ts`) to round-trip the counter
- [x] 3.4 Unit tests covering the new field's persistence and restore round-trip

## 4. git_push integration

- [x] 4.1 Extend `WorkerToolContext` (or pass via factory) to expose a way to read and increment the active change's `verificationAttempts`
- [x] 4.2 Modify `createGitPushTool` in `src/tools/worker/gitPush.ts` to call `loadVerificationConfig(ctx.repoName)` before pushing
- [x] 4.3 When config is present with non-empty checks, invoke the runner; on pass, proceed to push
- [x] 4.4 On fail, increment `verificationAttempts`, compute remaining attempts, build the failure error payload (check name, exit code, truncated output, remaining attempts) and return via `errorResult`; do NOT push
- [x] 4.5 When the post-increment counter reaches the retry budget, return a distinguishable terminal error payload instructing the worker to call `report_status` and stop retrying
- [x] 4.6 When config is absent or `checks` is empty, behave exactly as today (push immediately, counter untouched)
- [x] 4.7 Unit tests: no-config passthrough, empty-checks passthrough, gate passes then push succeeds, gate fails within budget, gate fails and budget exhausts, push failure after successful gate still surfaces correctly

## 5. Dependency injection and type plumbing

- [x] 5.1 Add `loadVerificationConfig` and `runVerificationChecks` to `GitPushDeps` so tests can inject fakes
- [x] 5.2 Update `defaultGitPushDeps` with the real implementations
- [x] 5.3 Ensure `buildWorkerContext` / `buildClackTools` call sites compile without changes to unrelated tools

## 6. Shipped default and documentation

- [x] 6.1 Update `data/default_configuration/dev/changes.md` with a short paragraph explaining the verification gate, the per-repo config path, and the JSON schema
- [x] 6.2 Update the repo-instruction-files documentation (if any) to list `verification_checks.json` alongside `changes_instructions.md` and `worktree_setup_instructions.md`
- [x] 6.3 Do NOT add a default `verification_checks.json` — gate stays opt-in per repo

## 7. End-to-end verification

- [ ] 7.1 Manually exercise the gate against a test repo: add a `verification_checks.json` that intentionally fails, trigger a change, confirm the worker receives the failure, retries, and eventually aborts when the budget is exhausted *(manual — requires running bot against a real repo/Slack)*
- [ ] 7.2 Repeat with a passing config and confirm the PR is created normally *(manual — requires running bot)*
- [ ] 7.3 Confirm the execution log (visible via `find_sessions` / session inspection) contains the expected `Verification:` lines *(manual — requires running bot)*
- [x] 7.4 Run `npm test` and `npx tsc` and resolve any failures introduced by the change
