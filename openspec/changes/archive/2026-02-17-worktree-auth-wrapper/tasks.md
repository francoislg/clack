## 1. Create the wrapper

- [x] 1.1 Add `runClaudeInWorktree()` to `src/changes/execution.ts` — accepts all `runClaude` options plus required `repoName` and `worktreePath`, calls `setAuthenticatedRemote()` then delegates to `runClaude()`

## 2. Migrate call sites to the wrapper

- [x] 2.1 `executeChange()` in `execution.ts` — switch from `runClaude()` to `runClaudeInWorktree()`
- [x] 2.2 `runWorktreeSetup()` in `execution.ts` — switch to `runClaudeInWorktree()`
- [x] 2.3 `reviewPR()` in `pr.ts` — switch to `runClaudeInWorktree()`, remove manual `setAuthenticatedRemote()` and `getAuthenticatedCloneUrl()` calls
- [x] 2.4 `handleFollowUp("update")` push in `workflow.ts` — switch the `runClaude()` push call to `runClaudeInWorktree()` (this is the original bug fix)
- [x] 2.5 `detectFollowUpCommand()` in `detection.ts` — switch to `runClaudeInWorktree()` for consistency
- [x] 2.6 PR body generation in `pr.ts` (the `runClaude` call for template filling) — switch to `runClaudeInWorktree()`

## 3. Verify and clean up

- [x] 3.1 Verify no direct `runClaude()` calls remain in worktree contexts (grep for `runClaude({` in `changes/` and confirm each is either the definition, `runClaudeInWorktree`, or a non-worktree call like `generateChangePlan`)
- [x] 3.2 Ensure `setAuthenticatedRemote` is no longer called from `pr.ts` or `workflow.ts` — only from the wrapper and `createWorktree()`
