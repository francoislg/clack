## Why

When Clack restarts, all in-memory worker sessions (`activeSessions` and `sessionsByThread` Maps) are lost. This breaks three things: the Home Tab "Active Workers" section shows nothing, follow-up actions (merge, review, close, update) fail with "No active change session found", and the completion monitor finds no sessions to check for external PR merge/close. Sessions ARE persisted to disk as `data/worktree-sessions/{branch}/state.json`, but nothing reads them back on startup.

## What Changes

- Persist Slack thread references (`channel`, `threadTs`) in `PersistedSessionState` so sessions can be reconstructed with their Slack context
- Add a scanner to read all persisted session states from disk
- Add a lightweight `restoreSession()` that registers sessions in memory without side effects
- Add startup restoration logic that reads persisted states, filters by viability, and repopulates the in-memory Maps
- Wire restoration into the startup sequence between worktree cleanup and completion monitor start

## Capabilities

### New Capabilities

- `worker-session-restore`: Restoring worker sessions from disk on startup, including status-based filtering (restore `pr_created`, skip terminal/unrecoverable states) and graceful handling of legacy data

### Modified Capabilities

- `changes-workflow`: Add `channel` and `threadTs` to `PersistedSessionState` under the "Worker Visibility" requirement, so persisted session state includes the Slack thread references needed for restoration and notification

## Impact

- `src/changes/types.ts` — `PersistedSessionState` interface gains two new fields
- `src/changes/persistence.ts` — write new fields, add scanner function
- `src/changes/session.ts` — new `restoreSession()` function
- `src/changes/restore.ts` — new file with core restoration logic
- `src/index.ts` — startup sequence gains one new call
- Legacy `state.json` files (missing `channel`/`threadTs`) are gracefully skipped
