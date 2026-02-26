## Context

Today Clack maintains two parallel session systems:

1. **Q&A sessions** (`SessionContext` in `src/sessions.ts`) — persisted to disk as JSON in `data/sessions/`, looked up by thread via filesystem scan, timeout-based expiry.
2. **Change sessions** (`ChangeSession` in `src/changes/session.ts`) — held in an in-memory `Map`, persisted to `data/worktree-sessions/`, looked up by a `channel:threadTs` index, cleaned up when PRs are merged/closed.

Both are anchored to the same Slack thread (`channelId + threadTs`), but have separate lifecycles, separate storage, and separate lookup mechanisms. The `processMessage` flow in `core.ts` performs two independent lookups — `findSessionByThread()` for Q&A and `getSessionByThread()` for changes — then passes both to Claude.

This dual model causes: context amnesia when change sessions are cleaned up, inability to follow up after a PR is merged, and a hard routing split based on emoji type rather than message intent.

## Goals / Non-Goals

**Goals:**
- Single session entity per thread, always discoverable
- Thread context from Slack as the primary conversation memory (stop persisting what Slack already stores)
- Change execution as optional runtime state attached to the session, not a separate entity
- `workMode` as a permission-gated hint, not a hard mode switch
- No "closed" state — re-engaging a thread always works

**Non-Goals:**
- Changing the worker execution model (Claude running in a worktree with worker tools)
- Changing the permission system (role-based tool gating stays as-is)
- Changing the GitHub integration (PR operations via Octokit)
- Changing the DM-first delivery flow
- Migrating historical sessions (old sessions on disk can be cleaned up or ignored)

## Decisions

### 1. Merge `ChangeSession` fields into `SessionContext` as optional runtime state

**Decision**: Add optional change-execution fields to `SessionContext` rather than creating a new unified type from scratch.

**Rationale**: `SessionContext` is already the more mature type with disk persistence, button handler integration, and session restoration logic. `ChangeSession` is simpler and its fields map cleanly as optional additions. This minimizes the blast radius — most code that reads `SessionContext` continues to work unchanged.

**New optional fields on `SessionContext`:**
```typescript
// Active change execution state (runtime-only, not persisted to session JSON)
activeChange?: {
  branch: string;
  repo: string;
  description: string;
  worktree: WorktreeInfo;
  status: ChangeStatus;
  prUrl?: string;
  startedAt: Date;
  lastActivityAt: Date;
}
```

**Alternative considered**: Create a new `ThreadSession` type that wraps both. Rejected — adds a third type and a migration layer for no benefit.

### 2. Keep `activeChange` as in-memory runtime state, not persisted in session JSON

**Decision**: The `activeChange` field lives only in memory (and in `data/worktree-sessions/` for crash recovery). It is NOT written to the session's `context.json`.

**Rationale**: Active change state is ephemeral — it exists while a worktree is alive and an execution is running. Once the PR is merged/closed and the worktree cleaned up, the state is gone. The thread context from Slack already contains the PR URL, branch name, and outcome. Persisting it in the session JSON would create stale state that needs cleanup.

The `data/worktree-sessions/{branch}/state.json` file continues to exist for crash recovery (restoring `activeChange` into the session on startup), but it is the source of truth only for runtime state, not for conversation history.

### 3. Session files are cache + debug, not conversation source of truth

**Decision**: Keep session files on disk (`data/sessions/{id}/context.json`), but stop persisting conversation content (`refinements[]`, `lastAnswer`, `threadContext`). The Slack thread is the source of truth for conversation history. The session file persists: identity, staged intents, delivery metadata, errors, tool call history, and lastResponse (for button re-rendering).

**Rationale**: Session files serve two purposes that matter: (1) avoiding Slack API calls on reboot by caching session identity/metadata, and (2) debugging. They should NOT be the source of truth for what was said in the conversation — that's always in the thread. This eliminates the "session expired, lost context" failure mode without losing the debugging and restart benefits.

**Impact on Claude prompt construction** (`src/claude.ts`): The prompt currently includes `session.lastAnswer` and `session.refinements`. These will be replaced by the thread context (which already gets passed as `threadContext` on the session). The prompt builder may need adjustment to extract the previous answer from thread messages instead of a dedicated field.

### 4. Replace timeout-based expiry with indefinite persistence + storage-based eviction

**Decision**: Sessions no longer expire after N minutes of inactivity. They persist on disk until explicitly deleted or evicted by a storage cleanup job.

**Rationale**: The current 15-minute timeout means any button click after the timeout triggers session reconstruction from Slack. This is fragile and loses metadata (staged intents, tool call history). With indefinite persistence, sessions are always available. A periodic cleanup can evict sessions older than N days to manage storage.

**The `cleanupExpiredSessions` function** changes from "timeout-based" to "age-based" (e.g., clean up sessions older than 30 days with no active change execution).

### 5. Use an in-memory index for thread→session lookup

**Decision**: Maintain a `Map<string, string>` from `channel:threadTs` → `sessionId` in memory, populated lazily on first lookup and eagerly on session creation.

**Rationale**: The current `findSessionByThread()` does a filesystem scan of all session directories on every lookup — O(n) in the number of sessions. This is already slow and gets worse over time with indefinite persistence. An in-memory index makes lookup O(1). The index can be populated lazily (on first access, scan disk) or eagerly at startup.

**Alternative considered**: Use a SQLite database. Rejected — adds a dependency and complexity for what is essentially a key-value lookup. The in-memory map is sufficient since the bot runs as a single process.

### 6. `workMode` becomes a prompt hint, gated by existing permissions

**Decision**: When `workMode: true` is passed to `processMessage`, it still only applies if the user has `dev+` role. The difference is that it becomes a prompt hint ("the user is leaning toward wanting a code change") rather than changing which tool set is loaded.

**Rationale**: The tool set available to Claude should be based on the user's role and the session's runtime state, not on which emoji was used. A `dev+` user always gets change tools (when the workflow is enabled). The work emoji just adds a bias in the prompt.

**What changes**: The `workMode` flag no longer affects tool registration in `buildQueryTools`. Instead, it only affects the prompt hint in `claude.ts`. Tool registration is based purely on: user role and `changesWorkflowEnabled`. Active change state is prompt context, not a tool gating criterion.

### 7. Remove session-bound PR action tools; rely on GitHub MCP

**Decision**: Remove `request_review`, `request_merge`, and `request_close` Clack tools. PR operations (merge, close, comment, review status) are handled by Claude using the GitHub MCP server directly.

**Rationale**: The current action tools are zero-parameter wrappers that only work with the active change session's PR. They can't operate on any other PR. Meanwhile, Claude already has the GitHub MCP server which provides full PR capabilities on any repo/PR. Removing the session-bound tools and letting Claude use GitHub MCP directly means:
- Claude can merge/close/comment on any PR, not just the one Clack created
- A user can ask about PR #456 in a thread that's about PR #123
- No tool gating based on session state — Claude decides based on the user's message

**What remains**: `propose_change` stays (needs Clack infrastructure to create worktrees). `request_update` stays or is absorbed into `propose_change` detecting an existing worktree. Worker tools (`git_push`, `ensure_pr`, `merge_pr`, `close_pr`, `report_status`) stay for the execution phase inside worktrees.

**Alternative considered**: Make the action tools parameterized (accept a PR URL). Rejected — this duplicates what GitHub MCP already does, and Claude is better at determining intent than rigid tool parameters.

## Risks / Trade-offs

- **[Thread context limited to 20 messages]** → The Slack API fetch in `fetchThreadContext` currently limits to 20 messages. For very long threads, early context (original question, first answer) may be lost. → Mitigation: Increase the limit or fetch the first message + last N messages. Alternatively, persist a summary of key facts (PR URL, branch) as lightweight metadata on the session.

- **[In-memory index lost on restart]** → The thread→session index is in-memory and lost when the bot restarts. → Mitigation: Lazy population on first lookup (scan disk), or populate at startup from `data/sessions/`. The current `findSessionByThread` already scans disk, so this is no worse than today on restart.

- **[Larger session directories on disk]** → Without timeout-based cleanup, `data/sessions/` grows over time. → Mitigation: Age-based cleanup (e.g., 30 days). Sessions are small JSON files, so storage is not a concern at typical usage volumes.

- **[Prompt construction change]** → Replacing `refinements[]` and `lastAnswer` with thread context in the Claude prompt changes what Claude sees. → Mitigation: Thread context already includes this information. The main risk is if the prompt format change confuses Claude, but since we're giving it the same information in a more natural format (the actual conversation), this should improve quality.

## Migration Plan

1. **Add `activeChange` field to `SessionContext`** — backward compatible, existing sessions just don't have it.
2. **Add in-memory thread→session index** — populate from existing sessions on startup.
3. **Update `processMessage`** — single session lookup instead of two.
4. **Remove session-bound action tools** — delete `request_review`, `request_merge`, `request_close`; simplify `buildQueryTools` to role-only gating.
5. **Update `claude.ts` prompt builder** — derive change context from `session.activeChange`, derive refinements from thread context. Ensure prompt tells Claude to use GitHub MCP for PR operations.
6. **Update change workflow** — `startChangeWorkflow` attaches `activeChange` to the existing session instead of creating a separate `ChangeSession`.
7. **Update completion monitor** — clears `activeChange` from the unified session instead of removing a separate session.
8. **Update restore logic** — `restoreSession` from `data/worktree-sessions/` populates `activeChange` on matching thread sessions.
9. **Remove `src/changes/session.ts`** — the `activeSessions` and `sessionsByThread` maps are replaced by the unified index.
10. **Remove `refinements[]`, `lastAnswer`** from `SessionContext` — create a migration to strip these from existing session JSON files (or just stop reading them).
11. **Replace timeout-based expiry** with age-based cleanup.

Rollback: All changes are to internal data structures. If issues arise, revert the code and the old session files on disk still work.

## Open Questions

- **Thread context limit**: Should we increase the Slack API limit from 20 messages, or adopt a "first message + last N" strategy for long threads?
- **Age-based cleanup threshold**: What's a reasonable default? 30 days? 7 days? Configurable?
- **Session ID format**: The current format encodes `channelId-messageTs-userId-timestamp`. With thread-based sessions, should we switch to `channelId-threadTs` (without userId) since the session is per-thread, not per-user? Or keep per-user sessions within the same thread?
