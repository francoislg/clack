## Why

Git authentication tokens embedded in remote URLs expire after 1 hour. The current code requires each call site to manually refresh the token before any git push — and the `update` follow-up handler doesn't, causing push failures. This is a structural problem: any new code path that involves a push must remember to call `setAuthenticatedRemote()`, making the bug class inevitable.

## What Changes

- Introduce a `runClaudeInWorktree()` wrapper that always refreshes the git remote authentication token before delegating to `runClaude()`
- All Claude invocations that operate inside a worktree must use this wrapper instead of calling `runClaude()` directly
- Remove scattered `setAuthenticatedRemote()` calls from individual workflow functions (`reviewPR`, `handleFollowUp`, etc.) — the wrapper handles it
- The direct `simple-git` push in `createPR()` keeps its own auth refresh (it doesn't go through Claude)

## Capabilities

### New Capabilities

_None — this is a structural refactoring of existing capabilities._

### Modified Capabilities

- `claude-code-integration`: Add requirement that all worktree-context Claude invocations go through an auth-aware wrapper, making token refresh automatic rather than per-call-site
- `repository-management`: Clarify that token refresh for Claude-mediated git operations is structurally enforced via the worktree wrapper, not manually per call site

## Impact

- `src/changes/execution.ts`: New `runClaudeInWorktree()` export; `executeChange()` and `runWorktreeSetup()` switch to it
- `src/changes/pr.ts`: `reviewPR()` drops its manual auth refresh, uses wrapper
- `src/changes/workflow.ts`: `handleFollowUp("update")` push path fixed (was the original bug)
- `src/changes/detection.ts`: `detectFollowUpCommand()` switches to wrapper (doesn't push, but consistency)
- `src/worktrees.ts`: `setAuthenticatedRemote` may move to a shared util or stay for `createWorktree`'s direct git usage
