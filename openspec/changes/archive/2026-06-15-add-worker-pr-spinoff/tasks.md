## 1. Worker intent staging plumbing

- [x] 1.1 Add a worker-side IntentStore in `buildWorkerTools` (`src/tools/server.ts`), created fresh per build and passed to the tool factory exactly as `buildQueryTools` does — NOT a field on `WorkerToolContext` (query mode keeps it local, so the context type carries no mutable staging state); expose it via the worker result's `getStagedIntents()`
- [x] 1.2 Define a `SpinoffIntent` type (`paths: string[]`, `description`, `proposedBranch`, `patchPath`) backed by a zod schema (the single source of truth for shape + defaults, per the repo convention — reuse `zodErrorToResult` for errors), and register it in the staged-intent union. Apply the same schema to any spinoff-derived fields persisted on the sibling's `ChangePlan`/change-session state so they validate on restore
- [x] 1.3 Add `stagedSpinoffs?` to `ExecutionResult` (`src/changes/types.ts`) and populate it in `executeChange()` (`src/changes/execution.ts`) by draining the worker store after the run

## 2. `propose_spinoff` worker tool

- [x] 2.1 Create `src/tools/worker/proposeSpinoff.ts`: validate the proposed branch against the `clack/{type}/{name}` pattern (reuse the pattern from `actions/proposeChange.ts`); error + stage-nothing on invalid input
- [x] 2.2 In the tool, capture `git diff` restricted to the named paths, write the patch to a host-shared temp file under `data/`, and return the path on the staged intent
- [x] 2.3 In the tool, revert the slice in the originating worktree — `git checkout -- <path>` for tracked paths, delete for newly-added paths (distinguish via `git status` before reverting)
- [x] 2.4 Stage the `SpinoffIntent` and return its ref to the worker
- [x] 2.5 Register `propose_spinoff` in the worker toolset assembly (`src/tools/server.ts`) and gate it to worker mode only

## 3. Orchestrator sibling provisioning

- [x] 3.1 In `src/changes/workflow.ts`, after `executeChange()` returns and the originating session has transitioned to `pr_created` (worker slot released), add a step that drains `execResult.stagedSpinoffs`
- [x] 3.2 For each intent (sequentially): resolve a non-colliding branch name (check live worktrees/branches, append a disambiguating suffix on collision)
- [x] 3.3 Post a NEW top-level `chat.postMessage` (no `thread_ts`) in the originating channel and create a new session bound to that message's ts (`createSession` in `src/sessions.ts`)
- [x] 3.4 Build a sibling `ChangeRequest` + `ChangePlan` and call `startChangeWorkflow(...)` with the new session id; bypass the per-user active-change cap for orchestrator-initiated siblings while keeping `pool.acquire()` capacity checks
- [x] 3.5 In the sibling's worker run, apply the captured patch on the fresh branch before the normal commit/push/PR flow; on `git apply` failure, report in the sibling thread and retain the patch (parent and other siblings unaffected)
- [x] 3.6 Handle `PoolExhausted` from sibling `pool.acquire()` gracefully: report a retry hint in the sibling thread, continue with remaining siblings
- [x] 3.7 Ensure the captured patch is retained on ANY post-stage provisioning failure (branch-name resolution, `pool.acquire()`/`PoolExhausted`, session creation, `startChangeWorkflow` error, patch apply) — never discard it on account of the parent's state — since the slice was already reverted from the parent at stage time (design D3); each failure surfaces the retained patch's location for recovery

## 4. Slack thread cross-linking

- [x] 4.1 Post a cross-link line in the originating thread pointing to each sibling thread, and a back-link in each sibling thread to the originating thread
- [x] 4.2 Add all new direct-to-Slack strings to `src/i18n/strings/en.ts` and `src/i18n/strings/fr.ts` (route through `t()`), keeping key/placeholder parity and non-identical FR values

## 5. Worker-mode guidance

- [x] 5.1 Add worker-mode guidance describing when to use `propose_spinoff` (unrelated refactor surfaced; reviewer asked to split) and forbidding spinning off the entire change. Place it on the worker-mode prompt surface — the `propose_spinoff` tool description plus the worker system-prompt assembly (`src/claude/promptBuilder.ts` / `src/changes/askClaudeWorktree.ts`) — not the query-mode prompt

## 6. Tests

- [x] 6.1 Unit test `propose_spinoff`: valid/invalid branch, patch capture path, tracked-vs-new revert logic (mock git at the boundary, no real subprocess)
- [x] 6.2 Unit test the orchestrator dispatch: drains intents, provisions sequentially after parent release, bypasses user cap, handles `PoolExhausted` and branch-name collision (mock pool + Slack + `startChangeWorkflow` deps)
- [x] 6.3 Unit test the no-spinoff path: empty `stagedSpinoffs` ⇒ no dispatch, behavior unchanged
- [x] 6.4 Integration test (`*.integration.test.ts`): a worker run that stages one spinoff produces a sibling session on a distinct branch/thread with the slice's patch applied and the slice absent from the parent

## 7. Verification

- [x] 7.1 `npx tsc` clean, `npx oxlint` + `npx oxfmt --check` clean on touched files
- [x] 7.2 Full `npm test` passes
- [x] 7.3 Run `openspec validate add-worker-pr-spinoff --strict`
