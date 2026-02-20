## Context

Worker sessions (`ChangeSession`) live in two module-level Maps in `src/changes/session.ts`: `activeSessions` (by ID) and `sessionsByThread` (by channel:threadTs → ID). These are populated by `createSession()` during change execution and consumed by the Home Tab, follow-up handlers, and the completion monitor.

On restart, these Maps start empty. Sessions ARE persisted to disk as `data/worktree-sessions/{branch}/state.json` but nothing reads them back. The `PersistedSessionState` type also lacks `channel` and `threadTs`, which are needed to reconstruct the thread index and send Slack notifications.

## Goals / Non-Goals

**Goals:**
- Restore `pr_created` worker sessions into memory on startup so the Home Tab, follow-up buttons, and completion monitor work after a restart
- Recover sessions that were mid-execution when the process died, downgrading them to `pr_created` if they have a PR (the agent is gone but the PR is still trackable)
- Persist Slack thread references (`channel`, `threadTs`) in `state.json` for use by restoration

**Non-Goals:**
- Re-launching interrupted Claude agents — if the agent was executing when the process died, we don't re-run it. The PR (if any) is tracked; if there's no PR, the worktree is preserved for a manual re-request.
- Restoring Q&A sessions (already handled by lazy restoration in `session-management` spec)
- Migrating legacy `state.json` files to add the new fields — they're gracefully skipped

## Decisions

### 1. Add fields to `PersistedSessionState` as `string | null` rather than optional

**Decision:** Use `channel: string | null` and `threadTs: string | null` instead of `channel?: string`.

**Rationale:** Legacy files that lack these fields will produce `undefined` from `JSON.parse`. Using `| null` in the type makes it clear these are intentionally nullable at the persistence boundary, and we check with a truthiness guard (`if (state.channel && state.threadTs)`) which handles both `null` and `undefined`. Using optional (`?:`) would also work but muddies the intent — these fields are always written in new code, they're only missing in legacy data.

### 2. Downgrade mid-execution sessions to `pr_created` rather than skipping them

**Decision:** Sessions with status `executing`/`planning`/`reviewing`/`merging` that have a `prUrl` are restored as `pr_created`.

**Rationale:** The Claude agent that was running is dead after restart — there's no way to resume it. But if a PR exists, the session is still valuable: the user can request review, merge, update, or close. Restoring as `pr_created` correctly reflects reality (PR exists, no agent running) and enables all follow-up actions.

**Alternative considered:** Skip all non-`pr_created` sessions. Rejected because this would lose track of PRs that were created during an execution that was interrupted after `git_push`/`ensure_pr` but before status was updated to `pr_created`.

### 3. Skip sessions without PR when agent was mid-execution

**Decision:** Sessions in `executing`/`planning`/`reviewing`/`merging` without a `prUrl` are marked as `failed` on disk and NOT restored to memory.

**Rationale:** Without a PR, there's nothing to track or act on. The agent was interrupted before creating a PR. The worktree is preserved on disk (per existing spec) so the user can re-request the change. Marking as `failed` on disk prevents future restarts from repeatedly trying to evaluate these sessions.

### 4. New file `src/changes/restore.ts` rather than adding to existing modules

**Decision:** Create a dedicated module for the restoration logic.

**Rationale:** `session.ts` manages the in-memory Maps and their CRUD operations. `persistence.ts` handles disk I/O. Restoration is a cross-cutting startup concern that reads from persistence and writes to session state — it belongs in its own module to avoid circular complexity and keep the startup concern isolated.

### 5. `restoreSession()` in `session.ts` is a thin Map insertion

**Decision:** `restoreSession()` only inserts into `activeSessions` and `sessionsByThread` Maps. No disk writes, no folder creation, no logging.

**Rationale:** The session already exists on disk. We're just hydrating the in-memory index. Any disk writes would overwrite the original timestamps and metadata. The function mirrors `createSession()` in shape but is deliberately minimal.

### 6. Wire into startup between worktree init and completion monitor

**Decision:** Call `restoreWorkerSessions()` after `initializeWorktrees()` (which cleans up stale worktrees) and before `startCompletionMonitor()` (which needs sessions in memory to check PRs).

**Rationale:** The ordering is important: worktree cleanup may remove worktrees for sessions we'd otherwise try to restore, so it runs first. The completion monitor needs sessions in memory, so restoration runs before it. Both are inside the existing `if (config.changesWorkflow?.enabled)` guard.

## Risks / Trade-offs

- **[Stale sessions]** → If a PR was externally merged/closed during downtime, the restored session will be stale until the completion monitor runs its first check (default 15 minutes). This is acceptable — the monitor will clean it up.
- **[Legacy data gap]** → Sessions persisted before this change lack `channel`/`threadTs` and will be silently skipped. The worktrees and PRs still exist but won't appear in the Home Tab until the next action. This is the correct trade-off vs. trying to look up Slack thread info retroactively.
- **[Worktree removed during downtime]** → If someone manually deletes a worktree directory while the bot is down, the session is skipped during restoration. The `state.json` remains on disk with its current status — it will be cleaned up by the existing stale folder cleanup.
