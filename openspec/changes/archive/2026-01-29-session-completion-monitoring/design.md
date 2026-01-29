## Context

Change sessions currently track active work via in-memory state (`activeSessions` Map in `session.ts`) and persist state to `data/worktree-sessions/`. When a PR is merged or closed via Slack commands (merge/close), the system properly cleans up:
- Removes the session from memory
- Deletes the worktree
- Removes the session folder

However, if someone merges or closes the PR directly on GitHub (via web UI, CLI, or another tool), the session remains orphaned:
- Memory still holds the session
- Worktree stays on disk
- Home tab shows stale "active workers"

The system needs a background monitor to detect these external completions and clean up automatically.

## Goals / Non-Goals

**Goals:**
- Detect when PRs are merged or closed outside of Slack
- Automatically clean up orphaned sessions (worktree, session folder, memory)
- Optionally notify users in the original Slack thread when auto-cleanup occurs
- Configurable polling interval to balance responsiveness vs API load

**Non-Goals:**
- Real-time webhook-based detection (adds complexity, requires GitHub App setup)
- Detecting PR state changes other than merged/closed (e.g., draft status, review states)
- Automatic retry or recovery of failed sessions

## Decisions

### 1. Polling-based detection over webhooks

**Decision:** Use periodic polling via GitHub CLI (`gh pr view`) rather than GitHub webhooks.

**Rationale:**
- Simpler to implement - no webhook infrastructure needed
- Works with any GitHub authentication method (PAT, gh CLI auth)
- Polling interval is configurable for different use cases
- Acceptable latency (5-minute default is reasonable for cleanup)

**Alternatives considered:**
- GitHub webhooks: More responsive but requires GitHub App configuration, public endpoint, signature verification
- GitHub Actions: Could trigger cleanup but adds workflow complexity

### 2. Single scheduler in main process

**Decision:** Add a `startCompletionMonitor()` / `stopCompletionMonitor()` scheduler in `src/index.ts` lifecycle.

**Rationale:**
- Follows existing pattern (session cleanup scheduler, sync scheduler)
- Runs in same process, has direct access to `activeSessions` Map
- Simple `setInterval` with configurable period

### 3. Check only sessions with PRs in `pr_created` status

**Decision:** Only poll PR status for sessions that have `status === "pr_created"` and a valid `prUrl`.

**Rationale:**
- Sessions in `executing` or `planning` don't have PRs yet
- Sessions in `completed` or `failed` are already done
- Minimizes unnecessary API calls

### 4. Cleanup behavior matches manual merge/close

**Decision:** When a PR is detected as merged/closed externally, perform the same cleanup as the manual Slack commands:
- Delete the worktree via `removeWorktree()`
- Remove the session folder (if completed) via `removeSessionFolder()`
- Remove from `activeSessions` Map via `removeSession()`
- For merged: set status to `completed`
- For closed: set status to `failed` (matches "abandoned" semantics)

**Rationale:**
- Consistent behavior regardless of how completion happens
- Reuses existing cleanup logic

### 5. Optional Slack notification

**Decision:** When auto-cleanup occurs, send a message to the original Slack thread notifying the user.

**Rationale:**
- User knows their session was cleaned up
- Provides context (merged vs closed)
- Can be disabled via config if too noisy

## Risks / Trade-offs

**Risk:** GitHub API rate limiting with many active sessions
→ **Mitigation:** Check sessions sequentially with delays; configurable interval (default 5 min); only check `pr_created` sessions

**Risk:** PR URL format changes or gh CLI output changes
→ **Mitigation:** Use `gh pr view --json state` for structured output; defensive parsing

**Risk:** Session cleanup races with manual Slack commands
→ **Mitigation:** Check if session still exists before cleanup; use existing `removeSession()` which is idempotent

**Trade-off:** Polling latency vs API load
→ Default 15-minute interval since cleanup is not time-critical. Configurable for users who prefer faster detection.
