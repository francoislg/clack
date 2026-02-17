## Context

All Claude invocations inside worktrees go through `runClaude()` in `execution.ts`. Some of these invocations allow `Bash` (meaning Claude can run `git push`), and a fresh GitHub App installation token must be embedded in the remote URL before any push. Today, each call site is individually responsible for calling `setAuthenticatedRemote()` — and the `update` follow-up path forgot to, causing push failures after token expiry (~1 hour).

There are two kinds of git auth consumers:
1. **Claude-mediated** — Claude runs `git push` inside a worktree (execution, review, update)
2. **Direct** — our Node code pushes via `simple-git` (PR creation in `createPR()`)

## Goals / Non-Goals

**Goals:**
- Make it structurally impossible to forget token refresh before Claude-mediated git operations
- Fix the existing bug where `handleFollowUp("update")` doesn't refresh auth
- Single entry point for all worktree Claude invocations

**Non-Goals:**
- Changing how `createPR()` pushes directly via `simple-git` (it already handles its own auth)
- Changing `createWorktree()`'s auth refresh for `git fetch` (different lifecycle)
- Token refresh during long-running Claude sessions (>1 hour mid-execution) — out of scope

## Decisions

### Decision 1: Wrapper function over credential helper

**Choice**: `runClaudeInWorktree()` wrapper that refreshes auth then delegates to `runClaude()`

**Alternatives considered**:
- **Git credential helper via env vars** (`GIT_CONFIG_COUNT`): Elegant, but couples `runClaude` to git internals and doesn't cover `simple-git` calls. Also requires Git 2.31+.
- **Centralized `authenticatedPush()` function**: Only covers pushes, doesn't help with `git fetch` or other auth-needing operations Claude might run.
- **Moving all pushes to our code**: Requires changing Claude prompts and adding post-execution orchestration. Higher risk for the bug being fixed.

**Rationale**: The wrapper is simple, obvious, and enforces the rule at the right boundary — "entering a worktree context." Any developer adding a new workflow step sees `runClaudeInWorktree` and follows the pattern.

### Decision 2: Wrapper lives in `execution.ts`

The wrapper is co-located with `runClaude()` since it's a thin layer on top. It requires `repoName` (to look up the repo URL) and `worktreePath` (to set the remote), making it impossible to call without the info needed for auth.

### Decision 3: Keep `setAuthenticatedRemote` as a shared utility

`setAuthenticatedRemote()` stays in `worktrees.ts` for use by both the wrapper and `createWorktree()`. It's not removed — it's just no longer called directly from workflow code.

## Risks / Trade-offs

- **Unnecessary token refreshes** for Claude calls that don't push (e.g., intent detection, PR body generation) → Negligible cost. Token is cached with 5-min buffer, so most calls hit the cache. Simplicity wins over micro-optimization.
- **Long-running sessions** where the token expires mid-execution → Same limitation as today. Addressing this would require the credential helper approach (Option A from explore). Can be layered on later if needed.
- **New call sites forgetting to use the wrapper** → Mitigated by naming convention. `runClaude()` stays exported but developers see `runClaudeInWorktree()` used everywhere in the changes module. Could add a lint rule or doc comment later.
